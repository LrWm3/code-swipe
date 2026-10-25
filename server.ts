import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { TAG_CATEGORIES_REVERSE as STANDARD_TAGS, LANGUAGE_STYLE_SUPPORT } from "./src/training";

dotenv.config({ quiet: true });

const app = express();
const PORT = Number(process.env.PORT || 3000);

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

app.use(express.json());
app.use("/api", (_req, res, next) => {
  if (!ai) {
    res.status(503).json({
      success: false,
      error: "Set GEMINI_API_KEY to enable card generation and the AI tutor.",
      isRateLimit: false,
      isHighDemand: false,
      retryAfterSeconds: 0,
    });
    return;
  }
  next();
});

function chooseCategory(unlocked: string[], rounds: Record<string, number>): string {
  const list = unlocked && unlocked.length > 0 ? unlocked : ["Logic"];
  
  // Find any category that is unlocked and in slow rollout (1 to 20 rounds)
  const slowCategories = list.filter(c => c !== "Logic" && rounds[c] !== undefined && rounds[c] <= 20);
  
  if (slowCategories.length > 0) {
    const target = slowCategories[slowCategories.length - 1];
    const r = rounds[target] || 0;
    const probabilityOfTarget = r <= 10 ? 0.10 : 0.20;
    
    if (Math.random() < probabilityOfTarget) {
      return target;
    }
  }
  
  const fullyUnlocked = list.filter(c => c === "Logic" || (rounds[c] !== undefined && rounds[c] > 20));
  if (fullyUnlocked.length > 0) {
    return fullyUnlocked[Math.floor(Math.random() * fullyUnlocked.length)];
  }
  
  return list[Math.floor(Math.random() * list.length)];
}

function getInterpolatedWeight(elo: number, Z: number, H: number, F: number, maxWeight: number): number {
  if (elo <= Z) return 0;
  if (elo >= F) return maxWeight;
  if (elo <= H) {
    return parseFloat((((elo - Z) / (H - Z)) * (maxWeight / 2)).toFixed(2));
  } else {
    return parseFloat(((maxWeight / 2) + ((elo - H) / (F - H)) * (maxWeight / 2)).toFixed(2));
  }
}

function weightedRandomSelect(candidates: { name: string; weight: number }[]): string | null {
  if (candidates.length === 0) return null;
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return candidates[0].name;
  let r = Math.random() * totalWeight;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.name;
  }
  return candidates[candidates.length - 1].name;
}

function selectAuthorshipStyles(elo: number, language: string) {
  if (elo < 750) {
    return {
      iterationStyle: "imperative",
      conditionalStyle: "imperative-branching",
      idiomStyle: "standard"
    };
  }

  const iterationSpecs = [
    { name: "for-each", Z: 700, H: 800, F: 900, maxWeight: 64 },
    { name: "functional-pipeline", Z: 900, H: 1000, F: 1100, maxWeight: 64 },
    { name: "recursive", Z: 1100, H: 1200, F: 1300, maxWeight: 48 },
    { name: "fold-reduce", Z: 1200, H: 1300, F: 1400, maxWeight: 48 }
  ];

  const conditionalSpecs = [
    { name: "pattern-matching", Z: 800, H: 900, F: 1000, maxWeight: 128 }
  ];

  const langSupported = LANGUAGE_STYLE_SUPPORT[language] || LANGUAGE_STYLE_SUPPORT["Python"];

  // 1. Iteration candidates
  const iterationCandidates: { name: string; weight: number }[] = [];
  if (langSupported.iteration.includes("imperative")) {
    iterationCandidates.push({ name: "imperative", weight: 48 });
  }
  iterationSpecs.forEach(spec => {
    if (langSupported.iteration.includes(spec.name)) {
      const w = getInterpolatedWeight(elo, spec.Z, spec.H, spec.F, spec.maxWeight);
      if (w > 0) {
        iterationCandidates.push({ name: spec.name, weight: w });
      }
    }
  });

  // 2. Conditional candidates
  const conditionalCandidates: { name: string; weight: number }[] = [];
  if (langSupported.conditional.includes("imperative-branching")) {
    conditionalCandidates.push({ name: "imperative-branching", weight: 64 });
  }
  conditionalSpecs.forEach(spec => {
    if (langSupported.conditional.includes(spec.name)) {
      const w = getInterpolatedWeight(elo, spec.Z, spec.H, spec.F, spec.maxWeight);
      if (w > 0) {
        conditionalCandidates.push({ name: spec.name, weight: w });
      }
    }
  });

  // 3. Idiom styles candidates
  const idiomCandidates: { name: string; weight: number }[] = [
    { name: "standard", weight: 64 }
  ];
  const idiomaticW = getInterpolatedWeight(elo, 850, 950, 1050, 160);
  if (idiomaticW > 0) {
    idiomCandidates.push({ name: "idiomatic", weight: idiomaticW });
  }
  const obscureW = getInterpolatedWeight(elo, 1000, 1100, 1200, 32);
  if (obscureW > 0) {
    idiomCandidates.push({ name: "obscure", weight: obscureW });
  }

  const iterationStyle = weightedRandomSelect(iterationCandidates) || "imperative";
  const conditionalStyle = weightedRandomSelect(conditionalCandidates) || "imperative-branching";
  const idiomStyle = weightedRandomSelect(idiomCandidates) || "standard";

  return { iterationStyle, conditionalStyle, idiomStyle };
}

app.post("/api/generate-cards", async (req, res) => {
  try {
    const { 
      language, 
      globalElo, 
      conceptMastery, 
      unlockedCategories, 
      categoryUnlockRounds, 
      recentConcepts 
    } = req.body;

    const targetLang = language || "Python";
    const cleanUnlocked = unlockedCategories && unlockedCategories.length > 0 ? unlockedCategories : ["Logic"];
    const cleanRounds = categoryUnlockRounds || {};
    const cleanMastery = conceptMastery || {};
    const playerElo = typeof globalElo === 'number' ? globalElo : 800;

    // 1. Select target error category based on slow rollout math
    const targetCategory = chooseCategory(cleanUnlocked, cleanRounds);

    // 2. Choose standard tag for target category
    const tagsPool = STANDARD_TAGS[targetCategory as keyof typeof STANDARD_TAGS] || STANDARD_TAGS["Logic"];
    let availableTags = tagsPool.filter(t => !recentConcepts?.includes(t));
    if (availableTags.length === 0) availableTags = tagsPool;
    const targetTag = availableTags[Math.floor(Math.random() * availableTags.length)];

    // 3. Compute target Elo
    const modifier = cleanMastery[targetTag] !== undefined ? cleanMastery[targetTag] : 1.0;
    const targetElo = Math.max(100, Math.round(playerElo * modifier));

    const avoidance = (recentConcepts && recentConcepts.length > 0)
      ? `\nTo ensure variety, DO NOT generate problems similar to these recently answered concepts:\n- ${recentConcepts.join("\n- ")}`
      : "";

    // 4. Compute style requirements
    const { iterationStyle, conditionalStyle, idiomStyle } = selectAuthorshipStyles(playerElo, targetLang);

    const prompt = `You are a world-class coding tutor in ${targetLang}. Generate exactly 2 distinct programming/functional problem concepts in ${targetLang}.
Target Difficulty Level (standard Elo rating): ${targetElo} Elo.
This rating maps as follows:
- Elo < 1000: Beginner (simple syntax bugs, basic off-by-one/logical slips)
- Elo 1000 - 1399: Intermediate (typical logic slips, minor improper indices, scope/state issues)
- Elo 1400 - 1799: Advanced (race conditions, subtle security flaws risk, API abuse, memory problems)
- Elo >= 1800: Expert (elite traps, deep language-specific edge cases, micro-performance regressions)

Target Bug Focus Category: subtle ${targetCategory} errors.
Target Concept Tag: "${targetTag}".
${avoidance}

CRITICAL AUTHORSHIP STYLE SELECTION DETAILS:
You MUST code the exercises using the following requested programming paradigms:
- Iteration Style: "${iterationStyle}"
(Definition:
 * imperative: explicit for/while loops with manual index tracking.
 * for-each: value-based iteration, hiding the index (or using of/in syntax).
 * functional-pipeline: declarative chaining (map, filter).
 * fold-reduce: state accumulation over a collection (reduce/fold).
 * recursive: traversal via self-referential function calls.
)
- Conditional Style: "${conditionalStyle}"
(Definition:
 * imperative-branching: standard if, else if, and switch statements.
 * pattern-matching: advanced branching using type matching/destructuring/match if language supports it, else imperative.
)
- Idiom Style: "${idiomStyle}"
(Definition:
 * standard: use constructs and patterns found in many languages over shorthand.
 * idiomatic: prefer language specific idiomatic shorthand.
 * obscure: implementation is non-standard and "clever" regardless of correctness.
)

Both coding snippets (buggy and clean variants) for each problem concept must adhere to these three selected styles and paradigms.

CRITICAL RULES:
1. Provide realistic multi-line code snippets with correct syntax and proper indentations.
2. For each problem concept, provide EXACTLY one correct implementation variant and EXACTLY one buggy variant.
3. Ensure the code snippets are valid ${targetLang} code.
4. DO NOT write debugging commentaries or answers in the code comments or docstrings.
5. DO NOT mention authorship style in the code comments or docstrings.
6. In the variants, "code" must be a fully readable string, formatting with normal newlines and indentation.`;

    const responseSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Descriptive name of the function, e.g. process_data or parse_token." },
          docstring: { type: Type.STRING, description: "Objective description of what the code is trying to achieve." },
          baseElo: { type: Type.INTEGER, description: "The actual estimated Elo difficulty rating of this concept (e.g. integer between 800 and 2200 matching targetElo)." },
          iterationStyle: { type: Type.STRING, description: "Must match the requested Iteration Style." },
          conditionalStyle: { type: Type.STRING, description: "Must match the requested Conditional Style." },
          idiomStyle: { type: Type.STRING, description: "Must match the requested Idiom Style." },
          tags: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }, 
            description: "Concept tags associated with this problem - must include the target concept tag." 
          },
          variants: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "A unique variant ID, e.g. var_1, var_2." },
                is_correct: { type: Type.BOOLEAN, description: "True if code is perfect, False if buggy with the selected error focus." },
                code: { type: Type.STRING, description: "The actual multi-line snippet code block." },
                explanation: { type: Type.STRING, description: "Explain why this variation is correct or precisely identify the bug if buggy." }
              },
              required: ["id", "is_correct", "code", "explanation"]
            }
          }
        },
        required: ["name", "docstring", "baseElo", "tags", "variants"]
      }
    };

    const response = await ai!.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 1.0,
      }
    });

    const resultText = response.text || "[]";
    const rawResult = JSON.parse(resultText);
    
    // Legacy cache fallback on generated cards to ensure robust metadata mapping
    const result = Array.isArray(rawResult) ? rawResult.map(c => {
      return {
        ...c,
        iterationStyle: c.iterationStyle ? c.iterationStyle : iterationStyle,
        conditionalStyle: c.conditionalStyle ? c.conditionalStyle : conditionalStyle,
        idiomStyle: c.idiomStyle ? c.idiomStyle : idiomStyle
      };
    }) : [];

    res.json({
      success: true,
      errorType: targetCategory,
      data: result
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Gemini Card Generation Error:", error);
    
    const isRateLimit = errorMsg.includes("429") || 
                        errorMsg.includes("RESOURCE_EXHAUSTED") || 
                        errorMsg.includes("quota") ||
                        errorMsg.includes("limit") ||
                        errorMsg.includes("limit: 20");
                        
    const isHighDemand = errorMsg.includes("503") || 
                        errorMsg.includes("UNAVAILABLE") || 
                        errorMsg.includes("high demand") ||
                        errorMsg.includes("temporary");

    // Extract retry seconds from error message if possible
    let retryAfterSeconds = 60; // Default fallback
    const matchSeconds = errorMsg.match(/retry(?:ing|After)?\s+in\s+([\d.]+)\s*s/i);
    if (matchSeconds && matchSeconds[1]) {
      retryAfterSeconds = Math.ceil(parseFloat(matchSeconds[1]));
    } else {
      const matchDelay = errorMsg.match(/"retryDelay"\s*:\s*"(\d+)s"/);
      if (matchDelay && matchDelay[1]) {
        retryAfterSeconds = parseInt(matchDelay[1], 10);
      }
    }

    res.status(isRateLimit ? 429 : (isHighDemand ? 503 : 500)).json({
      success: false,
      error: errorMsg,
      isRateLimit: isRateLimit || isHighDemand,
      isHighDemand,
      retryAfterSeconds: isRateLimit ? retryAfterSeconds : (isHighDemand ? 30 : 0)
    });
  }
});

// API: Ask AI Tutor
app.post("/api/ask-tutor", async (req, res) => {
  try {
    const { language, code, docstring, is_correct, explanation } = req.body;

    const prompt = `As an encouraging, friendly, and expert programming tutor, explain step-by-step why the following ${language} code is ${is_correct ? "correct" : "buggy"}.
Function Goal: "${docstring}"
Code to audit:
${code}

Tutor Explanation provided so far:
"${explanation}"

Help the student understand the concepts, what traps to look out for, and how to write elegant, secure, and performant code next time. Use clean visual formatting with markdown.`;

    const response = await ai!.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        temperature: 0.7,
      }
    });

    res.json({
      success: true,
      response: response.text || "I was unable to consult the tutor at this moment."
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("AI Tutor Consultation Error:", error);
    
    const isRateLimit = errorMsg.includes("429") || 
                        errorMsg.includes("RESOURCE_EXHAUSTED") || 
                        errorMsg.includes("quota") ||
                        errorMsg.includes("limit") ||
                        errorMsg.includes("limit: 20");
                        
    let retryAfterSeconds = 60;
    const matchSeconds = errorMsg.match(/retry(?:ing|After)?\s+in\s+([\d.]+)\s*s/i);
    if (matchSeconds && matchSeconds[1]) {
      retryAfterSeconds = Math.ceil(parseFloat(matchSeconds[1]));
    }

    res.status(isRateLimit ? 429 : 500).json({
      success: false,
      error: errorMsg,
      isRateLimit,
      retryAfterSeconds: isRateLimit ? retryAfterSeconds : 0
    });
  }
});

// Handle serving the frontend
async function main() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(import.meta.dirname, "client");
    app.use(express.static(distPath));
    // Serve index.html for undefined routes in React SPA
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    const address = server.address();
    if (address && typeof address !== "string") {
      console.log(`Server running on http://0.0.0.0:${address.port}`);
    }
  });
  server.on("error", (error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
