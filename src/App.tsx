import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BookOpen, 
  Settings, 
  History, 
  Flame, 
  ChevronRight, 
  LogOut, 
  Play, 
  CheckCircle2, 
  HelpCircle, 
  XCircle,
  CheckCircle,
  User as UserIcon, 
  RotateCcw, 
  Sparkles,
  Award,
  Calendar,
  AlertTriangle,
  Lightbulb,
  ChevronDown,
  Clock
} from "lucide-react";
import hljs from "highlight.js";
import "highlight.js/styles/vs2015.css";
import { getOfflineCards } from "./offlineCards";

// Firebase Imports
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  query, 
  where,
  orderBy, 
  limit, 
  getDocFromServer,
  addDoc,
  deleteDoc
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();

// Verification Connection to Firestore according to skill checklist
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration. Client is offline.");
    }
  }
}
testConnection();

// Conforming Error Handling according to skill Checklist
enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function safeJsonStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    if (value instanceof Error) {
      const error: any = {};
      Object.getOwnPropertyNames(value).forEach((k) => {
        error[k] = (value as any)[k];
      });
      return error;
    }
    return value;
  });
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error("Firestore error logged: ", safeJsonStringify(errInfo));
  throw new Error(safeJsonStringify(errInfo));
}

export const TAG_CATEGORIES: Record<string, string> = {
  // Logic
  "null-pointer": "Logic",
  "boundary-condition": "Logic",
  "index-error": "Logic",
  "off-by-one": "Logic",
  "infinite-loop": "Logic",
  "type-mismatch": "Logic",
  "unhandled-exception": "Logic",
  "floating-point-error": "Logic",
  "unintended-mutation": "Logic",
  "incorrect-implementation": "Logic",
  // Performance
  "unnecessary-copy": "Performance",
  "quadratic-loop": "Performance",
  "memory-leak": "Performance",
  "inefficient-lookup": "Performance",
  "cache-miss": "Performance",
  "race-condition": "Performance",
  "deadlock": "Performance",
  "thread-starvation": "Performance",
  "state-desync": "Performance",
  "blocking-event-loop": "Performance",
  "orphaned-promise": "Performance",
  "database-n-plus-one": "Performance",
  "blocking-io": "Performance",
  "excessive-network-calls": "Performance",
  "connection-pool-exhaustion": "Performance",
  // Security
  "sql-injection": "Security",
  "xss": "Security",
  "buffer-overflow": "Security",
  "broken-auth": "Security",
  "path-traversal": "Security",
  "hardcoded-secrets": "Security",
  "csrf": "Security",
  "insecure-deserialization": "Security",
  "ssrf": "Security",
  "weak-crypto": "Security",
  "privilege-escalation": "Security",
  "cors-misconfiguration": "Security",
  // Architecture
  "circular-dependency": "Architecture",
  "tight-coupling": "Architecture",
  "improper-abstraction": "Architecture",
  "god-object": "Architecture",
  "dead-code": "Architecture",
  "violation-of-dry": "Architecture",
  "magic-numbers": "Architecture",
  "solid-violation": "Architecture",
  "leaky-abstraction": "Architecture",
  "feature-envy": "Architecture"
};

export const TAG_CATEGORIES_REVERSE: Record<string, string[]> = {
  "Logic": [
    "null-pointer", "boundary-condition", "index-error", "off-by-one", 
    "infinite-loop", "type-mismatch", "unhandled-exception", 
    "floating-point-error", "unintended-mutation", "incorrect-implementation"
  ],
  "Performance": [
    "unnecessary-copy", "quadratic-loop", "memory-leak", "inefficient-lookup", 
    "cache-miss", "race-condition", "deadlock", "thread-starvation", "state-desync", 
    "blocking-event-loop", "orphaned-promise", "database-n-plus-one", "blocking-io", 
    "excessive-network-calls", "connection-pool-exhaustion"
  ],
  "Security": [
    "sql-injection", "xss", "buffer-overflow", "broken-auth", 
    "path-traversal", "hardcoded-secrets", "csrf", "insecure-deserialization", 
    "ssrf", "weak-crypto", "privilege-escalation", "cors-misconfiguration"
  ],
  "Architecture": [
    "circular-dependency", "tight-coupling", "improper-abstraction", 
    "god-object", "dead-code", "violation-of-dry", "magic-numbers", 
    "solid-violation", "leaky-abstraction", "feature-envy"
  ]
};

export const LANGUAGE_STYLE_SUPPORT: Record<string, { iteration: string[], conditional: string[] }> = {
  "Python": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "JavaScript": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching"]
  },
  "Rust": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "Java": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "Kotlin": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  },
  "Deno": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching"]
  },
  "C": {
    iteration: ["imperative", "recursive"],
    conditional: ["imperative-branching"]
  },
  "C++": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching"]
  },
  "C#": {
    iteration: ["imperative", "for-each", "functional-pipeline", "fold-reduce", "recursive"],
    conditional: ["imperative-branching", "pattern-matching"]
  }
};

// Language mapper helper
const getLanguageTag = (langName: string) => {
  const map: Record<string, string> = { 
    "Python": "python", 
    "JavaScript": "javascript", 
    "Rust": "rust", 
    "Java": "java", 
    "Kotlin": "kotlin", 
    "Deno": "typescript", 
    "C": "c", 
    "C++": "cpp", 
    "C#": "csharp" 
  };
  return map[langName] || "plaintext";
};

function getCommentSymbolForLanguage(language: string): string[] {
  const norm = language.toLowerCase();
  if (norm.includes("python") || norm.includes("shell") || norm.includes("bash") || norm.includes("ruby") || norm.includes("perl")) {
    return ["#"];
  }
  if (norm.includes("sql")) {
    return ["--", "#"];
  }
  if (norm.includes("html") || norm.includes("xml")) {
    return [];
  }
  return ["//"];
}

export function stripBugComments(code: string, language: string): string {
  if (!code) return "";
  
  const commentSymbols = getCommentSymbolForLanguage(language);
  const bugKeywords = [
    "bug", "incorrect", "error", "wrong", "fix", "issue", "broken", 
    "problem", "fault", "mistake", "fails", "failure", "flaw", 
    "vulnerab", "unsafe", "bypasses", "leak", "exploit", "here"
  ];

  const lines = code.split("\n");
  const processedLines: string[] = [];

  for (let line of lines) {
    let strippedLine = line;
    let shouldOmitLine = false;

    // Handle HTML/XML block comments first
    if (language.toLowerCase().includes("html") || language.toLowerCase().includes("xml")) {
      strippedLine = strippedLine.replace(/<!--([\s\S]*?)-->/g, (match, p1) => {
        if (bugKeywords.some(keyword => p1.toLowerCase().includes(keyword))) {
          return "";
        }
        return match;
      });
      if (strippedLine.trim() === "") {
        shouldOmitLine = true;
      }
    } else {
      // Handle C-style block comments /* ... */
      strippedLine = strippedLine.replace(/\/\*([\s\S]*?)\*\//g, (match, p1) => {
        if (bugKeywords.some(keyword => p1.toLowerCase().includes(keyword))) {
          return "";
        }
        return match;
      });
      if (line.trim() !== "" && strippedLine.trim() === "") {
        shouldOmitLine = true;
      }
    }

    // Handle standard single line comments if not omitted
    if (!shouldOmitLine) {
      for (const symbol of commentSymbols) {
        const commentIndex = strippedLine.indexOf(symbol);
        if (commentIndex === -1) continue;

        // Skip absolute URL protocols in C-style comments (e.g., http://)
        if (symbol === "//" && commentIndex > 0 && strippedLine[commentIndex - 1] === ":") {
          continue;
        }

        const commentContent = strippedLine.substring(commentIndex + symbol.length).toLowerCase();
        
        if (bugKeywords.some(keyword => commentContent.includes(keyword))) {
          const beforeComment = strippedLine.substring(0, commentIndex);
          if (beforeComment.trim() === "") {
            shouldOmitLine = true;
          } else {
            strippedLine = beforeComment.trimEnd();
          }
          break;
        }
      }
    }

    if (!shouldOmitLine) {
      processedLines.push(strippedLine);
    }
  }

  return processedLines.join("\n");
}

// Programmatic, safe highlight component to avoid mutating React fiber nodes directly
function HighlightedCode({ 
  code, 
  language, 
  shouldStripComments = false 
}: { 
  code: string; 
  language: string; 
  shouldStripComments?: boolean;
}) {
  const processedCode = useMemo(() => {
    if (shouldStripComments) {
      return stripBugComments(code, language);
    }
    return code;
  }, [code, language, shouldStripComments]);

  const highlightedHtml = useMemo(() => {
    try {
      return hljs.highlight(processedCode, { language: getLanguageTag(language) }).value;
    } catch (e) {
      // safe fallback escape
      return processedCode
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  }, [processedCode, language]);

  return (
    <pre className="text-xs leading-relaxed font-mono whitespace-pre select-text">
      <code 
        className={`hljs language-${getLanguageTag(language)}`}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    </pre>
  );
}

// Types & Classes
export interface Card {
  id: string;
  funcName: string;
  docstring: string;
  language: string;
  errorType: string;
  code: string;
  is_correct: boolean;
  explanation: string;
  availableAt?: number;
  baseElo?: number;
  tags?: string[];
  iterationStyle?: string;
  conditionalStyle?: string;
  idiomStyle?: string;
}

interface Attempt {
  id: string;
  funcName: string;
  docstring: string;
  language: string;
  errorType: string;
  code: string;
  is_correct: boolean;
  explanation: string;
  swipedType: "left" | "right" | "unsure";
  userGuessedCorrectly: boolean;
  timeTakenMs: number;
  answeredAt: string;
  baseElo?: number;
  tags?: string[];
  iterationStyle?: string;
  conditionalStyle?: string;
  idiomStyle?: string;
}

interface SkillNode {
  level: number;
  history: number[];
  solved: number;
  failed: number;
  unsure: number;
  avgTimeMs: number;
  lastAnswered: string | null;
  recentConcepts: string[];
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // App state
  const [view, setView] = useState<"swipe" | "history" | "settings" | "manual">("swipe");
  const [deck, setDeck] = useState<Card[]>();

  // Loaded state sync'd with Firebase
  const [language, setLanguage] = useState("Python");
  const [errorTypes, setErrorTypes] = useState<string[]>(["Logic"]);
  const [skillsMatrix, setSkillsMatrix] = useState<Record<string, Record<string, SkillNode>>>({});
  const [dailyGoal, setDailyGoal] = useState({ date: "", correctCount: 0, reached: false });
  const [historyList, setHistoryList] = useState<Attempt[]>([]);
  const [selectedHistoryCard, setSelectedHistoryCard] = useState<Attempt | Card | null>(null);
  const [srsDueCount, setSrsDueCount] = useState(0);

  // Elo + Concept Tags framework states
  const [globalElo, setGlobalElo] = useState<number>(800);
  const [defaultStartingElo, setDefaultStartingElo] = useState<number>(800);
  const [conceptMastery, setConceptMastery] = useState<Record<string, number>>({});
  const [unlockedCategories, setUnlockedCategories] = useState<string[]>(["Logic"]);
  const [categoryUnlockRounds, setCategoryUnlockRounds] = useState<Record<string, number>>({});
  const [tagCategories, setTagCategories] = useState<Record<string, string>>(TAG_CATEGORIES);

  const [lastAction, setLastAction] = useState<{
    card: Card;
    userGuessedCorrectly: boolean;
    actionType: "left" | "right" | "unsure";
  } | null>(null);

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    correct: boolean;
    isUnsure: boolean;
    eloDiff: number;
    newTotalElo: number;
    tags: string[];
    prevMastery: Record<string, number>;
    nextMastery: Record<string, number>;
    funcName: string;
  } | null>(null);
  const [feedbackTimer, setFeedbackTimer] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [synthesisError, setSynthesisError] = useState<{
    message: string;
    isRateLimit: boolean;
    isHighDemand?: boolean;
    retryAfterSeconds: number;
  } | null>(null);

  // Retry countdown ticker for API rate limits
  useEffect(() => {
    if (!synthesisError || !synthesisError.isRateLimit || synthesisError.retryAfterSeconds <= 0) {
      if (synthesisError && synthesisError.retryAfterSeconds <= 0) {
        setSynthesisError(null);
      }
      return;
    }

    const interval = setInterval(() => {
      setSynthesisError((prev) => {
        if (!prev) return null;
        if (prev.retryAfterSeconds <= 1) {
          clearInterval(interval);
          return null;
        }
        return {
          ...prev,
          retryAfterSeconds: prev.retryAfterSeconds - 1,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [synthesisError]);

  const handleLoadOfflineCards = useCallback(() => {
    setSynthesisError(null);
    setIsGenerating(true);
    try {
      const offline = getOfflineCards(language, errorTypes);
      const cardsWithUniqueIds = offline.map((c) => {
        const errorCategory = c.errorType;
        const tagsForCategory = TAG_CATEGORIES_REVERSE[errorCategory] || ["boundary-condition"];
        const matchedTag = tagsForCategory[Math.floor(Math.random() * tagsForCategory.length)];
        return {
          ...c,
          id: `offline_${c.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          baseElo: Math.round(globalElo + (Math.random() * 200 - 100)),
          tags: [matchedTag]
        };
      }).sort(() => Math.random() - 0.5);

      setDeck((prev) => {
        const incoming = cardsWithUniqueIds.filter((nc) => !prev || !prev.some((pc) => pc.id === nc.id));
        return prev ? [...prev, ...incoming] : [...incoming];
      });
    } catch (err) {
      console.error("Failed to load offline cards", err);
    } finally {
      setIsGenerating(false);
    }
  }, [language, errorTypes, globalElo]);
  
  interface LanguageStats {
    elo: number;
    conceptMastery: Record<string, number>;
    unlockedCategories: string[];
    categoryUnlockRounds: Record<string, number>;
    styleStats?: Record<string, { solved: number; failed: number; unsure: number }>;
  }
  const [languageStats, setLanguageStats] = useState<Record<string, LanguageStats>>({});

  // Check Auth State on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await loadUserData(currentUser.uid, currentUser.email || "");
      } else {
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadUserData = async (uid: string, email: string) => {
    try {
      setAuthLoading(true);
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      const todayStr = new Date().toISOString().split("T")[0];

      if (userSnap.exists()) {
        const data = userSnap.data();
        const currentLang = data.language || "Python";
        setLanguage(currentLang);
        setErrorTypes(data.errorTypes || ["Logic"]);
        setSkillsMatrix(data.skillsMatrix || {});
        
        // Reset or load daily goal
        const savedGoal = data.dailyGoal || { date: todayStr, correctCount: 0, reached: false };
        if (savedGoal.date !== todayStr) {
          setDailyGoal({ date: todayStr, correctCount: 0, reached: false });
        } else {
          setDailyGoal(savedGoal);
        }

        const savedStartElo = data.defaultStartingElo ?? 800;
        setDefaultStartingElo(savedStartElo);

        const statsMap = data.languageStats || {};
        setLanguageStats(statsMap);

        const langStats = statsMap[currentLang] || {
          elo: savedStartElo,
          conceptMastery: {},
          unlockedCategories: ["Logic"],
          categoryUnlockRounds: {}
        };

        setGlobalElo(langStats.elo ?? savedStartElo);
        setConceptMastery(langStats.conceptMastery ?? {});
        setUnlockedCategories(langStats.unlockedCategories ?? ["Logic"]);
        setCategoryUnlockRounds(langStats.categoryUnlockRounds ?? {});
        setTagCategories(data.tagCategories ?? TAG_CATEGORIES);

        if (data.activeDeck && Array.isArray(data.activeDeck)) {
          const languageFilteredDeck = data.activeDeck.filter((card: Card) => card && card.language && card.language.toLowerCase() === currentLang.toLowerCase());
          setDeck(languageFilteredDeck);
        } else {
          setDeck([]);
        }
      } else {
        // Initialize user profile in Firestore
        const initProfile = {
          userId: uid,
          email: email,
          language: "Python",
          errorTypes: ["Logic"],
          skillsMatrix: {},
          dailyGoal: { date: todayStr, correctCount: 0, reached: false },
          globalElo: 800,
          conceptMastery: {},
          unlockedCategories: ["Logic"],
          categoryUnlockRounds: {},
          tagCategories: TAG_CATEGORIES,
          defaultStartingElo: 800,
          activeDeck: [],
          languageStats: {
            "Python": {
              elo: 800,
              conceptMastery: {},
              unlockedCategories: ["Logic"],
              categoryUnlockRounds: {}
            }
          },
          updatedAt: new Date().toISOString()
        };
        await setDoc(userRef, initProfile);
        setLanguage("Python");
        setErrorTypes(["Logic"]);
        setSkillsMatrix({});
        setDailyGoal({ date: todayStr, correctCount: 0, reached: false });
        setGlobalElo(800);
        setConceptMastery({});
        setUnlockedCategories(["Logic"]);
        setCategoryUnlockRounds({});
        setTagCategories(TAG_CATEGORIES);
        setLanguageStats(initProfile.languageStats);
        setDefaultStartingElo(800);
        setDeck([]);
      }

      // Load History & SRS Due cards count
      await loadHistory(uid);
      await fetchSrsDueCount(uid);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const loadHistory = async (uid: string) => {
    try {
      const histCol = collection(db, "users", uid, "history");
      const snap = await getDocs(histCol);
      const attempts: Attempt[] = [];
      snap.forEach((doc) => {
        attempts.push(doc.data() as Attempt);
      });
      // Sort newest answers first
      attempts.sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime());
      setHistoryList(attempts);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `users/${uid}/history`);
    }
  };

  const fetchSrsDueCount = async (uid: string) => {
    try {
      const srsCol = collection(db, "users", uid, "srsQueue");
      const snap = await getDocs(srsCol);
      const now = Date.now();
      let due = 0;
      snap.forEach((doc) => {
        const item = doc.data();
        if (item.availableAt <= now) {
          due++;
        }
      });
      setSrsDueCount(due);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `users/${uid}/srsQueue`);
    }
  };

  // Safeguard: Ensure the problem deck strictly filters out card items that mismatch our active language selection
  useEffect(() => {
    if (deck && deck.length > 0) {
      const target = (language || "").toLowerCase();
      const hasMismatch = deck.some(
        (card) => !card || !card.language || card.language.toLowerCase() !== target
      );
      if (hasMismatch) {
        console.warn("SAFEGUARD: Detected and filtered out card elements not matching active language:", language);
        setDeck((prev) =>
          prev ? prev.filter((card) => card && card.language && card.language.toLowerCase() === target) : []
        );
      }
    }
  }, [deck, language]);

  // Auto-save active card deck to Firestore for refreshing resilience
  useEffect(() => {
    if (user && !authLoading && deck !== undefined) {
      const saveActiveDeck = async () => {
        try {
          const userRef = doc(db, "users", user.uid);
          await setDoc(userRef, {
            activeDeck: deck,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.warn("Failed to save active deck:", e);
        }
      };
      saveActiveDeck();
    }
  }, [deck, user, authLoading]);

  // Google Login handling
  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setDeck([]);
      setHistoryList([]);
      setView("swipe");
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const getSkillNode = useCallback((lang: string, errType: string): SkillNode => {
    if (skillsMatrix[lang]?.[errType]) return skillsMatrix[lang][errType];
    return { level: 1, history: [], solved: 0, failed: 0, unsure: 0, avgTimeMs: 0, lastAnswered: null, recentConcepts: [] };
  }, [skillsMatrix]);

  // Synchronize dynamic profile data to Firebase
  const syncProfileToFirebase = async (
    uid: string, 
    lang: string, 
    errs: string[], 
    matrix: typeof skillsMatrix, 
    goal: typeof dailyGoal,
    elo: number,
    mastery: typeof conceptMastery,
    unlocked: string[],
    rounds: typeof categoryUnlockRounds,
    tc: typeof tagCategories,
    statsMap?: Record<string, LanguageStats>
  ) => {
    try {
      const userRef = doc(db, "users", uid);
      const finalStatsMap = statsMap || {
        ...languageStats,
        [lang]: {
          elo,
          conceptMastery: mastery,
          unlockedCategories: unlocked,
          categoryUnlockRounds: rounds
        }
      };

      await setDoc(userRef, {
        userId: uid,
        email: user?.email || "",
        language: lang,
        errorTypes: errs,
        skillsMatrix: matrix,
        dailyGoal: goal,
        globalElo: elo,
        conceptMastery: mastery,
        unlockedCategories: unlocked,
        categoryUnlockRounds: rounds,
        tagCategories: tc,
        languageStats: finalStatsMap,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
    }
  };

  // Card Generator combining SRS Queue, Read-Through Cache global bank, and Gemini API backend calls
  const generateCards = useCallback(async (currentLang?: string, currentErrs?: string[]) => {
    if (isGenerating || !user) return;

    // Do not auto-fetch if rate-limited and countdown is active
    if (synthesisError && synthesisError.isRateLimit && synthesisError.retryAfterSeconds > 0) {
      return;
    }

    setIsGenerating(true);

    const targetLang = currentLang || language;
    const activeErrs = currentErrs || errorTypes;
    const targetCategory = activeErrs[Math.floor(Math.random() * activeErrs.length)] || "Logic";

    try {
      // 1. Try fetching from personal immediate SRS queue first
      const srsCol = collection(db, "users", user.uid, "srsQueue");
      const srsSnap = await getDocs(srsCol);
      const now = Date.now();
      let srsCardToServe: Card | null = null;
      let srsDocId = "";

      srsSnap.forEach((doc) => {
        const item = doc.data() as Card;
        if (!srsCardToServe && item.availableAt && item.availableAt <= now && item.language && item.language.toLowerCase() === targetLang.toLowerCase() && activeErrs.includes(item.errorType)) {
          srsCardToServe = {
            ...item,
            iterationStyle: item.iterationStyle || "imperative",
            conditionalStyle: item.conditionalStyle || "imperative-branching",
            idiomStyle: item.idiomStyle || "standard"
          };
          srsDocId = doc.id;
        }
      });

      if (srsCardToServe) {
        // Delete from srsQueue database once pulled
        const cardItem: Card = srsCardToServe;
        await deleteDoc(doc(db, "users", user.uid, "srsQueue", srsDocId));
        setDeck(prev => {
          if (prev && prev.some(pc => pc.id === cardItem.id)) return prev;
          return prev ? [...prev, cardItem] : [cardItem];
        });
        await fetchSrsDueCount(user.uid);
        setIsGenerating(false);
        setSynthesisError(null);
        return;
      }

      // 2. READ-THROUGH CACHE: Check Global Questions Bank first
      try {
        const qQuery = query(
          collection(db, "questions"),
          where("language", "==", targetLang),
          where("category", "==", targetCategory)
        );
        const qSnap = await getDocs(qQuery);
        const candidates: any[] = [];
        
        qSnap.forEach((docSnap) => {
          const qData = docSnap.data();
          if (qData && qData.language && qData.language.toLowerCase() === targetLang.toLowerCase()) {
            const qElo = qData.current_elo || defaultStartingElo || 800;
            const diff = Math.abs(qElo - globalElo);
            candidates.push({ ...qData, id: docSnap.id, eloDiff: diff });
          }
        });

        // Sort by closest Elo difficulty
        candidates.sort((a, b) => a.eloDiff - b.eloDiff);

        // Fast Validation Check on the top candidates (within Elo +/- 150)
        let foundCachedCard: Card | null = null;
        const candidateBatch = candidates.filter(c => c.eloDiff <= 150).slice(0, 10);

        for (const candidate of candidateBatch) {
          const attemptRef = doc(db, "users", user.uid, "attempts", candidate.id);
          const attemptSnap = await getDoc(attemptRef);

          if (!attemptSnap.exists()) {
            // Unseen variant: Ensure we haven't seen a sibling variant or duplicate of this concept in history
            const candFuncName = (candidate.funcName || "").toLowerCase();
            const candDocstring = (candidate.text || candidate.docstring || "").trim().toLowerCase();
            const candCode = (candidate.code || "").trim();

            const isSiblingSeen = historyList.some(h => {
              if (h.language !== targetLang) return false;
              if (candFuncName && h.funcName && h.funcName.toLowerCase() === candFuncName) return true;
              if (candDocstring && h.docstring && h.docstring.trim().toLowerCase() === candDocstring) return true;
              if (candCode && h.code && h.code.trim() === candCode) return true;
              return false;
            });

            if (isSiblingSeen) {
              console.log("CACHE SKIP: Sibling/duplicate of concept already seen in history", candidate.id, candFuncName);
              continue; // Skip this cached candidate
            }

            // Unseen: Cache Hit!
            foundCachedCard = {
              id: candidate.id,
              funcName: candidate.funcName || candidate.id.split("_")[1] || "process",
              docstring: candidate.text || candidate.docstring,
              language: candidate.language,
              errorType: candidate.category || candidate.errorType,
              code: candidate.code,
              is_correct: candidate.is_correct,
              explanation: candidate.answer || candidate.explanation,
              baseElo: candidate.current_elo || candidate.baseElo || defaultStartingElo || 800,
              tags: candidate.tags || ["boundary-condition"],
              iterationStyle: candidate.iterationStyle || "imperative",
              conditionalStyle: candidate.conditionalStyle || "imperative-branching",
              idiomStyle: candidate.idiomStyle || "standard"
            };
            break;
          } else {
            const attemptData = attemptSnap.data();
            const nextSrs = attemptData?.next_srs_review_date || 0;
            if (nextSrs <= Date.now()) {
              // Due for review SRS: Cache Hit!
              foundCachedCard = {
                id: candidate.id,
                funcName: candidate.funcName || candidate.id.split("_")[1] || "process",
                docstring: candidate.text || candidate.docstring,
                language: candidate.language,
                errorType: candidate.category || candidate.errorType,
                code: candidate.code,
                is_correct: candidate.is_correct,
                explanation: candidate.answer || candidate.explanation,
                baseElo: candidate.current_elo || candidate.baseElo || defaultStartingElo || 800,
                tags: candidate.tags || ["boundary-condition"],
                iterationStyle: candidate.iterationStyle || "imperative",
                conditionalStyle: candidate.conditionalStyle || "imperative-branching",
                idiomStyle: candidate.idiomStyle || "standard"
              };
              break;
            }
          }
        }

        if (foundCachedCard) {
          console.log("CACHE HIT: Serving global question", foundCachedCard.id);
          const cachedCard: Card = foundCachedCard;
          setDeck(prev => {
            if (prev && prev.some(pc => pc.id === cachedCard.id)) return prev;
            return prev ? [...prev, cachedCard] : [cachedCard];
          });
          setIsGenerating(false);
          setSynthesisError(null);
          return;
        }
      } catch (cacheErr) {
        console.warn("Global Question Cache lookup failed or query index not yet built. Falling back to LLM.", cacheErr);
      }

      // 3. CACHE MISS: Fetch fresh cards from Gemini server API
      const response = await fetch("/api/generate-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: targetLang,
          globalElo,
          conceptMastery,
          unlockedCategories,
          categoryUnlockRounds,
          recentConcepts: historyList.slice(0, 10).map(h => h.docstring)
        })
      });

      const resJson = await response.json();
      if (!response.ok || !resJson.success) {
        const isRateLimit = resJson.isRateLimit || response.status === 429 || String(resJson.error).includes("429") || String(resJson.error).includes("RESOURCE_EXHAUSTED") || String(resJson.error).includes("quota");
        const isHighDemand = resJson.isHighDemand || response.status === 503 || String(resJson.error).includes("503") || String(resJson.error).includes("UNAVAILABLE") || String(resJson.error).includes("demand") || String(resJson.error).includes("temporary");
        
        const errorDetail = {
          message: resJson.error || "Gemini card synthesis failed",
          isRateLimit: isRateLimit || isHighDemand,
          isHighDemand,
          retryAfterSeconds: resJson.retryAfterSeconds || (isHighDemand ? 30 : 60)
        };
        setSynthesisError(errorDetail);
        throw new Error(errorDetail.message);
      }

      // Clear synthesis error state on success
      setSynthesisError(null);

      const activeDeckAdditions: Card[] = [];
      const publicPoolAdditions: Card[] = [];
      const targetErrorBack = resJson.errorType || "Logic";

      resJson.data.forEach((func: any) => {
        if (!func.variants || func.variants.length !== 2) return;

        const variants = func.variants.map((v: any, idx: number) => {
          const uniqueId = `gen_${func.name.toLowerCase()}_${v.id || idx}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          return {
            ...v,
            id: uniqueId,
            funcName: func.name,
            docstring: func.docstring,
            language: targetLang,
            errorType: targetErrorBack,
            code: v.code,
            baseElo: func.baseElo || defaultStartingElo || 800,
            tags: func.tags || ["boundary-condition"],
            iterationStyle: func.iterationStyle || "imperative",
            conditionalStyle: func.conditionalStyle || "imperative-branching",
            idiomStyle: func.idiomStyle || "standard"
          };
        }).sort(() => Math.random() - 0.5);

        // Serve first variant to immediate deck (queued to present to user)
        activeDeckAdditions.push(variants[0]);

        // Put the other variant STRICTLY into the global Questions database (review pool/public storage)
        publicPoolAdditions.push(variants[1]);
      });

      // Seeding: Simultaneously write the second variant (public pool) to the global shared Questions collection
      for (const vItem of publicPoolAdditions) {
        try {
          const qDocRef = doc(db, "questions", vItem.id);
          await setDoc(qDocRef, {
            id: vItem.id,
            text: vItem.docstring,
            answer: vItem.explanation,
            language: vItem.language,
            category: vItem.errorType,
            current_elo: vItem.baseElo || defaultStartingElo || 800,
            created_at: new Date().toISOString(),
            funcName: vItem.funcName,
            code: vItem.code,
            is_correct: vItem.is_correct,
            explanation: vItem.explanation,
            baseElo: vItem.baseElo || defaultStartingElo || 800,
            tags: vItem.tags || ["boundary-condition"],
            iterationStyle: vItem.iterationStyle || "imperative",
            conditionalStyle: vItem.conditionalStyle || "imperative-branching",
            idiomStyle: vItem.idiomStyle || "standard"
          });
        } catch (seedErr) {
          console.warn("Failed to seed global Questions collection with generated card:", seedErr);
        }
      }

      if (activeDeckAdditions.length === 0) {
        console.warn("Gemini synthesized successfully but returned 0 valid card variants. Gracefully falling back to loading offline cards.");
        const offline = getOfflineCards(targetLang, activeErrs);
        const fallbackCards = offline.map((c) => {
          const errorCategory = c.errorType;
          const tagsForCategory = TAG_CATEGORIES_REVERSE[errorCategory] || ["boundary-condition"];
          const matchedTag = tagsForCategory[Math.floor(Math.random() * tagsForCategory.length)];
          return {
            ...c,
            id: `offline_fallback_${c.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            baseElo: Math.round(globalElo + (Math.random() * 200 - 100)),
            tags: [matchedTag]
          };
        }).sort(() => Math.random() - 0.5);
        
        setDeck(prev => {
          const incoming = fallbackCards.filter(nc => !prev || !prev.some(pc => pc.id === nc.id));
          return prev ? [...prev, ...incoming] : [...incoming];
        });
        setIsGenerating(false);
        setSynthesisError(null);
        return;
      }

      setDeck(prev => {
        const incoming = activeDeckAdditions.filter(nc => !prev || !prev.some(pc => pc.id === nc.id));
        return prev ? [...prev, ...incoming] : [...incoming];
      });

      await fetchSrsDueCount(user.uid);
    } catch (error) {
      console.error("Synthesize error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota") || msg.includes("limit");
      const isHighDemand = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("demand") || msg.includes("temporary");
      setSynthesisError(prev => {
        if (prev) return prev;
        return {
          message: msg,
          isRateLimit: isRateLimit || isHighDemand,
          isHighDemand,
          retryAfterSeconds: isRateLimit ? 120 : (isHighDemand ? 30 : 0)
        };
      });
    } finally {
      setIsGenerating(false);
    }
  }, [user, language, errorTypes, synthesisError, globalElo, conceptMastery, unlockedCategories, categoryUnlockRounds, historyList]);

  // Card deck triggering
  useEffect(() => {
    if (user && (!deck || deck.length === 0) && !isGenerating && view === "swipe") {
      // If there's an active error and we have 0 cards left, trigger automatic offline cards loading as a transparent, friendly fallback
      if (synthesisError) {
        console.warn("SAFEGUARD: Empty deck and synthesis error active. Automatically activating offline practice fallback...");
        handleLoadOfflineCards();
      } else {
        generateCards();
      }
    } else if (user && deck && deck.length === 1 && !isGenerating && !synthesisError && view === "swipe") {
      generateCards();
    }
  }, [deck, isGenerating, view, user, generateCards, synthesisError, handleLoadOfflineCards]);

  // Handle answers and update telemetry matrix
  const handleAction = async (actionType: "left" | "right" | "unsure", timeTakenMs: number) => {
    if (!deck || deck.length === 0 || !user) return;

    const currentCard = deck[0];
    let userGuessedCorrectly = false;

    if (actionType === "right" && currentCard.is_correct) userGuessedCorrectly = true;
    if (actionType === "left" && !currentCard.is_correct) userGuessedCorrectly = true;

    // Update proficiencies (legacy support)
    const updatedMatrix = { ...skillsMatrix };
    if (!updatedMatrix[currentCard.language]) {
      updatedMatrix[currentCard.language] = {};
    }

    const node = { ...getSkillNode(currentCard.language, currentCard.errorType) };
    const totalAnswers = node.solved + node.failed + node.unsure;
    node.avgTimeMs = totalAnswers === 0 ? timeTakenMs : ((node.avgTimeMs * totalAnswers) + timeTakenMs) / (totalAnswers + 1);

    if (userGuessedCorrectly) {
      node.solved += 1;
    } else if (actionType === "unsure") {
      node.unsure += 1;
    } else {
      node.failed += 1;
    }

    node.lastAnswered = new Date().toISOString();
    
    // Add concept prevention history
    node.recentConcepts = node.recentConcepts || [];
    node.recentConcepts.push(currentCard.docstring);
    if (node.recentConcepts.length > 10) {
      node.recentConcepts.shift();
    }

    // Progression of levels (legacy support)
    node.history = [...node.history, userGuessedCorrectly ? 1 : 0];
    if (node.history.length > 10) {
      node.history.shift();
    }

    if (node.history.length === 10) {
      const correctRatio = node.history.filter(x => x === 1).length / 10;
      if (correctRatio >= 0.8 && node.level < 4) {
        node.level += 1;
        node.history = [];
      } else if (correctRatio < 0.5 && node.level > 1) {
        node.level -= 1;
        node.history = [];
      }
    }

    updatedMatrix[currentCard.language][currentCard.errorType] = node;
    setSkillsMatrix(updatedMatrix);

    // ELO & CONCEPT MASTERY CALCULATIONS
    const playerElo = globalElo;
    const cardElo = currentCard.baseElo ?? defaultStartingElo ?? 800;
    const expectedPlayer = 1 / (1 + Math.pow(10, (cardElo - playerElo) / 400));
    const actualScore = userGuessedCorrectly ? 1 : 0;
    const newGlobalElo = Math.max(100, Math.round(playerElo + 32 * (actualScore - expectedPlayer)));

    const prevMastery = { ...conceptMastery };
    const nextMastery = { ...conceptMastery };
    const cardTags = currentCard.tags && currentCard.tags.length > 0 ? currentCard.tags : ["boundary-condition"];
    const nextTagCategories = { ...tagCategories };
    const macroCategory = currentCard.errorType || "Logic";

    cardTags.forEach((tag) => {
      if (!nextTagCategories[tag]) {
        nextTagCategories[tag] = macroCategory;
      }
      const mod = nextMastery[tag] !== undefined ? nextMastery[tag] : 1.0;
      if (userGuessedCorrectly) {
        nextMastery[tag] = Math.min(2.0, parseFloat((mod + 0.05).toFixed(2)));
      } else {
        nextMastery[tag] = Math.max(0.4, parseFloat((mod - 0.25).toFixed(2)));
      }
    });

    // Handle organic unlock categories & slow rollout rounds
    const nextUnlocked = [...unlockedCategories];
    const nextRounds = { ...categoryUnlockRounds };

    nextUnlocked.forEach(c => {
      if (c !== "Logic") {
        nextRounds[c] = (nextRounds[c] || 0) + 1;
      }
    });

    const getAvgModifierForCategory = (cat: string) => {
      const tags = Object.keys(TAG_CATEGORIES).filter(k => TAG_CATEGORIES[k] === cat);
      if (tags.length === 0) return 1.0;
      const mods = tags.map(t => nextMastery[t] !== undefined ? nextMastery[t] : 1.0);
      return mods.reduce((sum, val) => sum + val, 0) / mods.length;
    };

    // Unlock + lock threshold checks
    // Logic -> Performance
    if (!nextUnlocked.includes("Performance")) {
      const avgLogic = getAvgModifierForCategory("Logic");
      if (avgLogic > 1.2) {
        nextUnlocked.push("Performance");
        nextRounds["Performance"] = 0;
      }
    } else {
      const avgPerf = getAvgModifierForCategory("Performance");
      if (avgPerf < 1.0) {
        const idx = nextUnlocked.indexOf("Performance");
        if (idx !== -1) nextUnlocked.splice(idx, 1);
        delete nextRounds["Performance"];
      }
    }

    // Performance -> Security
    if (nextUnlocked.includes("Performance") && !nextUnlocked.includes("Security")) {
      const avgPerf = getAvgModifierForCategory("Performance");
      if (avgPerf > 1.2) {
        nextUnlocked.push("Security");
        nextRounds["Security"] = 0;
      }
    } else if (nextUnlocked.includes("Security")) {
      const avgSec = getAvgModifierForCategory("Security");
      if (avgSec < 1.0) {
        const idx = nextUnlocked.indexOf("Security");
        if (idx !== -1) nextUnlocked.splice(idx, 1);
        delete nextRounds["Security"];
      }
    }

    // Security -> Architecture
    if (nextUnlocked.includes("Security") && !nextUnlocked.includes("Architecture")) {
      const avgSec = getAvgModifierForCategory("Security");
      if (avgSec > 1.2) {
        nextUnlocked.push("Architecture");
        nextRounds["Architecture"] = 0;
      }
    } else if (nextUnlocked.includes("Architecture")) {
      const avgArch = getAvgModifierForCategory("Architecture");
      if (avgArch < 1.0) {
        const idx = nextUnlocked.indexOf("Architecture");
        if (idx !== -1) nextUnlocked.splice(idx, 1);
         delete nextRounds["Architecture"];
      }
    }

    setGlobalElo(newGlobalElo);
    setConceptMastery(nextMastery);
    setUnlockedCategories(nextUnlocked);
    setCategoryUnlockRounds(nextRounds);
    setTagCategories(nextTagCategories);

    // Update Daily counters
    let nextGoal = { ...dailyGoal };
    if (userGuessedCorrectly) {
      const nextCount = dailyGoal.correctCount + 1;
      const reachedNow = nextCount === 10 && !dailyGoal.reached;
      if (reachedNow) {
        setShowGoalModal(true);
      }
      nextGoal = { ...dailyGoal, correctCount: nextCount, reached: dailyGoal.reached || reachedNow };
      setDailyGoal(nextGoal);
    }

    // Adaptive Spaced Repetition (SRS) interval prediction using ELO to calculate decay
    let nextSrsReviewDate = Date.now();
    if (userGuessedCorrectly) {
      const intervalHours = 24 * Math.pow(2, (playerElo - cardElo) / 150);
      const boundedHours = Math.max(12, Math.min(360, intervalHours));
      nextSrsReviewDate = Date.now() + Math.round(boundedHours * 60 * 60 * 1000);
    } else {
      const intervalHours = 4 * Math.pow(2, (playerElo - cardElo) / 150);
      const boundedHours = Math.max(0.083, Math.min(2, intervalHours)); // between 5 mins and 2 hours
      nextSrsReviewDate = Date.now() + Math.round(boundedHours * 60 * 60 * 1000);
    }

    // Recalculate Question's Elo (zero-sum opponent rating adjust)
    const expectedQuestion = 1 - expectedPlayer;
    const questionScore = userGuessedCorrectly ? 0 : 1;
    const newCardElo = Math.max(100, Math.round(cardElo + 32 * (questionScore - expectedQuestion)));

    // Log the answer history in Firebase
    const attemptId = `attempt_${currentCard.id}_${Date.now()}`;
    const attemptPayload: Attempt = {
      id: currentCard.id,
      funcName: currentCard.funcName,
      docstring: currentCard.docstring,
      language: currentCard.language,
      errorType: currentCard.errorType,
      code: currentCard.code,
      is_correct: currentCard.is_correct,
      explanation: currentCard.explanation,
      swipedType: actionType,
      userGuessedCorrectly,
      timeTakenMs,
      answeredAt: new Date().toISOString(),
      baseElo: newCardElo, // save updated rating
      tags: currentCard.tags || ["boundary-condition"],
      iterationStyle: currentCard.iterationStyle || "imperative",
      conditionalStyle: currentCard.conditionalStyle || "imperative-branching",
      idiomStyle: currentCard.idiomStyle || "standard"
    };

    // Modern attempts SRS fast cache payload
    const srsFastPayload = {
      timestamp: new Date().toISOString(),
      was_correct: userGuessedCorrectly,
      next_srs_review_date: nextSrsReviewDate
    };

    // Style statistics increments
    const currentLangStats = languageStats[language] || {
      elo: globalElo,
      conceptMastery: conceptMastery,
      unlockedCategories: unlockedCategories,
      categoryUnlockRounds: categoryUnlockRounds,
      styleStats: {}
    };

    const nextStyleStats = { ...(currentLangStats.styleStats || {}) };
    
    // update iterationStyle stats
    const iterS = currentCard.iterationStyle || "imperative";
    const prevIterStat = nextStyleStats[iterS] || { solved: 0, failed: 0, unsure: 0 };
    if (userGuessedCorrectly) {
      nextStyleStats[iterS] = { ...prevIterStat, solved: prevIterStat.solved + 1 };
    } else if (actionType === "unsure") {
      nextStyleStats[iterS] = { ...prevIterStat, unsure: prevIterStat.unsure + 1 };
    } else {
      nextStyleStats[iterS] = { ...prevIterStat, failed: prevIterStat.failed + 1 };
    }

    // update conditionalStyle stats
    const condS = currentCard.conditionalStyle || "imperative-branching";
    const prevCondStat = nextStyleStats[condS] || { solved: 0, failed: 0, unsure: 0 };
    if (userGuessedCorrectly) {
      nextStyleStats[condS] = { ...prevCondStat, solved: prevCondStat.solved + 1 };
    } else if (actionType === "unsure") {
      nextStyleStats[condS] = { ...prevCondStat, unsure: prevCondStat.unsure + 1 };
    } else {
      nextStyleStats[condS] = { ...prevCondStat, failed: prevCondStat.failed + 1 };
    }

    // update idiomStyle stats
    const idiomS = currentCard.idiomStyle || "standard";
    const prevIdiomStat = nextStyleStats[idiomS] || { solved: 0, failed: 0, unsure: 0 };
    if (userGuessedCorrectly) {
      nextStyleStats[idiomS] = { ...prevIdiomStat, solved: prevIdiomStat.solved + 1 };
    } else if (actionType === "unsure") {
      nextStyleStats[idiomS] = { ...prevIdiomStat, unsure: prevIdiomStat.unsure + 1 };
    } else {
      nextStyleStats[idiomS] = { ...prevIdiomStat, failed: prevIdiomStat.failed + 1 };
    }

    try {
      // Save Attempt record (legacy analytics log)
      await setDoc(doc(db, "users", user.uid, "history", attemptId), attemptPayload);
      
      // Save direct fast-lookup SRS user attempt record (optimized read-through cache)
      await setDoc(doc(db, "users", user.uid, "attempts", currentCard.id), srsFastPayload);

      // Recalculate/Synchronize the updated question rating back inside the global shared bank
      try {
        const qDocRef = doc(db, "questions", currentCard.id);
        await setDoc(qDocRef, {
          current_elo: newCardElo,
          baseElo: newCardElo
        }, { merge: true });
        console.log("Synchronized new Question Elo rating globally:", newCardElo);
      } catch (qErr) {
        console.warn("Could not sync updated question Elo globally (expected if offline/mock seeds):", qErr);
      }

      // Save/Queue wrong guesses & unsure cards in SRS collection 5 mins later instead of pure client state
      if (!userGuessedCorrectly || actionType === "unsure") {
        const srsCol = doc(db, "users", user.uid, "srsQueue", `srs_retry_${currentCard.id}`);
        await setDoc(srsCol, {
          ...currentCard,
          id: `${currentCard.id}_retry`,
          baseElo: newCardElo,
          availableAt: Date.now() + 5 * 60 * 1000 // Retry in 5 minutes for immediate reviews
        });
      }

      const nextStatsMap = {
        ...languageStats,
        [language]: {
          elo: newGlobalElo,
          conceptMastery: nextMastery,
          unlockedCategories: nextUnlocked,
          categoryUnlockRounds: nextRounds,
          styleStats: nextStyleStats
        }
      };
      setLanguageStats(nextStatsMap);

      // Sync Profile states
      await syncProfileToFirebase(user.uid, language, errorTypes, updatedMatrix, nextGoal, newGlobalElo, nextMastery, nextUnlocked, nextRounds, nextTagCategories, nextStatsMap);
      await loadHistory(user.uid);
      await fetchSrsDueCount(user.uid);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/history/${attemptId}`);
    }

    setLastAction({
      card: currentCard,
      userGuessedCorrectly,
      actionType
    });

    const isUnsure = actionType === "unsure";
    const eloDifference = isUnsure ? 0 : (newGlobalElo - playerElo);

    setActionFeedback({
      correct: userGuessedCorrectly,
      isUnsure: isUnsure,
      eloDiff: eloDifference,
      newTotalElo: newGlobalElo,
      tags: cardTags,
      prevMastery: prevMastery,
      nextMastery: nextMastery,
      funcName: currentCard.funcName
    });

    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
    }
    const timer = setTimeout(() => {
      setActionFeedback(null);
    }, 1200); // 1.2 seconds quick visual confirmation that fades away
    setFeedbackTimer(timer);

    setDeck(prev => prev ? prev.slice(1) : []);
  };

  const handleApplySettings = async (selectedLang: string, selectedErrs: string[]) => {
    setLanguage(selectedLang);
    setErrorTypes(selectedErrs);
    setDeck([]);
    setView("swipe");

    // Load or initialize stats for the newly selected language
    const langStats = languageStats[selectedLang] || {
      elo: defaultStartingElo || 800,
      conceptMastery: {},
      unlockedCategories: ["Logic"],
      categoryUnlockRounds: {},
      styleStats: {}
    };

    setGlobalElo(langStats.elo);
    setConceptMastery(langStats.conceptMastery);
    setUnlockedCategories(langStats.unlockedCategories);
    setCategoryUnlockRounds(langStats.categoryUnlockRounds);

    if (user) {
      // Record previous language stats and include new language stats
      const updatedStatsMap = {
        ...languageStats,
        [language]: {
          elo: globalElo,
          conceptMastery: conceptMastery,
          unlockedCategories: unlockedCategories,
          categoryUnlockRounds: categoryUnlockRounds,
          styleStats: languageStats[language]?.styleStats || {}
        },
        [selectedLang]: {
          ...langStats,
          styleStats: langStats.styleStats || {}
        }
      };
      setLanguageStats(updatedStatsMap);

      await syncProfileToFirebase(
        user.uid, 
        selectedLang, 
        selectedErrs, 
        skillsMatrix, 
        dailyGoal, 
        langStats.elo, 
        langStats.conceptMastery, 
        langStats.unlockedCategories, 
        langStats.categoryUnlockRounds, 
        tagCategories,
        updatedStatsMap
      );
      await generateCards(selectedLang, selectedErrs);
    }
  };

  const handleChangeDefaultStartingElo = async (val: number) => {
    setDefaultStartingElo(val);
    if (user) {
      try {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
          defaultStartingElo: val,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log("Updated global starting ELO to", val);
      } catch (err) {
        console.warn("Could not save starting ELO selection to firestore:", err);
      }
    }
  };

  const handleResetLanguageProgress = async (selectedStartingElo: number) => {
    if (!user) return;
    try {
      setAuthLoading(true);

      const targetLang = language;

      // 1. Delete Firestore history documents for this language
      const histCol = collection(db, "users", user.uid, "history");
      const histQuery = query(histCol, where("language", "==", targetLang));
      const histSnap = await getDocs(histQuery);
      for (const d of histSnap.docs) {
        await deleteDoc(doc(db, "users", user.uid, "history", d.id));
      }

      // 2. Delete Firestore attempts documents for this language
      const attemptsCol = collection(db, "users", user.uid, "attempts");
      const attemptsQuery = query(attemptsCol, where("language", "==", targetLang));
      const attemptsSnap = await getDocs(attemptsQuery);
      for (const d of attemptsSnap.docs) {
        await deleteDoc(doc(db, "users", user.uid, "attempts", d.id));
      }

      // 3. Clear srsQueue for this language
      const srsCol = collection(db, "users", user.uid, "srsQueue");
      const srsQuery = query(srsCol, where("language", "==", targetLang));
      const srsSnap = await getDocs(srsQuery);
      for (const d of srsSnap.docs) {
        await deleteDoc(doc(db, "users", user.uid, "srsQueue", d.id));
      }

      // 4. Update skillsMatrix state for this language (reset it)
      const updatedMatrix = { ...skillsMatrix };
      if (updatedMatrix[targetLang]) {
        delete updatedMatrix[targetLang];
      }

      // 5. Build reset statistics for the current language
      const resetStats = {
        elo: selectedStartingElo,
        conceptMastery: {},
        unlockedCategories: ["Logic"],
        categoryUnlockRounds: {},
        styleStats: {}
      };

      const updatedStatsMap = {
        ...languageStats,
        [targetLang]: resetStats
      };

      // 6. Update local states
      setGlobalElo(selectedStartingElo);
      setConceptMastery({});
      setUnlockedCategories(["Logic"]);
      setCategoryUnlockRounds({});
      setSkillsMatrix(updatedMatrix);
      setLanguageStats(updatedStatsMap);
      setDeck([]); // Clear current deck so new cards are fetched

      // 7. Persist to Firestore profile
      await syncProfileToFirebase(
        user.uid,
        targetLang,
        errorTypes,
        updatedMatrix,
        dailyGoal,
        selectedStartingElo,
        {},
        ["Logic"],
        {},
        tagCategories,
        updatedStatsMap
      );

      // Also update the Firestore profile's top-level defaultStartingElo field
      await setDoc(doc(db, "users", user.uid), {
        defaultStartingElo: selectedStartingElo
      }, { merge: true });

      // Reload history list in view
      await loadHistory(user.uid);
      await fetchSrsDueCount(user.uid);

      alert(`Successfully reset all progress for ${targetLang}! Your rating has been set to ${selectedStartingElo} ELO.`);
    } catch (err) {
      console.error("Error resetting language progress:", err);
      alert("Failed to reset progress. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-dash-bg flex flex-col items-center justify-center text-dash-text">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-dash-blue/30 border-t-dash-blue rounded-full animate-spin"></div>
          <Sparkles className="absolute w-6 h-6 text-dash-blue animate-pulse" />
        </div>
        <p className="mt-4 text-xs font-mono text-dash-muted">Loading secure developer workspace ...</p>
      </div>
    );
  }

  // Decoupled Landing / Login view
  if (!user) {
    return (
      <div className="min-h-screen bg-dash-bg text-dash-text flex flex-col justify-between py-12 px-6 relative overflow-hidden font-sans">
        {/* Glow Effects */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-dash-blue-glow rounded-full filter blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-0 w-80 h-80 bg-dash-green-glow rounded-full filter blur-3xl pointer-events-none"></div>

        <div className="text-center md:max-w-xl mx-auto flex-1 flex flex-col justify-center space-y-8 z-10">
          <div className="flex flex-col items-center space-y-3">
            <div className="p-3 bg-dash-blue/10 rounded-2xl border border-dash-blue/20 shadow-lg shadow-dash-blue/5 animate-[pulse_3s_infinite]">
              <span className="font-mono text-xl font-bold text-dash-blue tracking-tight">&lt;/&gt;</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight leading-none text-white font-sans uppercase">
              CODESWIPE PRO
            </h1>
            <p className="font-mono text-xs text-dash-blue tracking-widest uppercase">Technical Training Console</p>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white">Continuous Code Review, optimized.</h2>
            <p className="text-sm text-dash-muted leading-relaxed max-w-sm mx-auto">
              Swipe function cards based on bugs vs correctness. Keep your mental compile loops sharp with adaptive spaced repetition questions generated by Gemini.
            </p>
          </div>

          <div className="p-5 bg-dash-surface rounded-2xl border border-dash-border space-y-4 text-left max-w-sm mx-auto">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-dash-green shrink-0 mt-0.5" />
              <p className="text-xs text-dash-text">Firestore keeps active logs of reviewed snippets & profile tracking.</p>
            </div>
            <div className="flex items-start gap-3">
              <Flame className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              <p className="text-xs text-dash-text">Skills Matrix dynamically shifts levels based on evaluation thresholds.</p>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-dash-blue shrink-0 mt-0.5" />
              <p className="text-xs text-dash-text">Retries and review queues keep spaced repetition focused on weak spots.</p>
            </div>
          </div>

          <div className="pt-4 max-w-sm mx-auto w-full">
            <button
              onClick={handleLogin}
              id="btn-login-google"
              className="w-full h-14 bg-dash-blue hover:bg-dash-blue/90 text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-xl transition-all cursor-pointer border border-dash-blue/30 active:scale-95"
            >
              <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                <path d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.866-3.577-7.866-8s3.536-8 7.866-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C17.955 2.193 15.34 1 12.24 1 6.033 1 1 6.033 1 12.24s5.033 11.24 11.24 11.24c6.478 0 10.793-4.537 10.793-10.977 0-.74-.08-1.302-.178-1.86h-10.615z" />
              </svg>
              <span>Verify and Login with Google</span>
            </button>
          </div>
        </div>

        <div className="text-center z-10 pt-4">
          <p className="text-[10px] text-dash-muted font-mono uppercase tracking-widest">Secured with Attribute-Based Access Control</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col relative bg-dash-bg text-dash-text overflow-hidden select-none font-sans">
      
      {/* HEADER BAR */}
      <header className="bg-dash-surface border-b border-dash-border px-2 sm:px-4 flex justify-between items-center z-40 shrink-0 h-13 shadow-md">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="flex items-center gap-1">
            <div>
              <h1 className="text-xs sm:text-sm font-black tracking-wider uppercase leading-none text-white font-mono">
                CS
              </h1>
              <p className="hidden sm:block text-[8px] text-dash-blue tracking-widest uppercase font-mono leading-none mt-0.5 font-bold">Training Console</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 select-none font-mono">
            <span className="hidden sm:inline-flex text-[10px] font-black tracking-widest uppercase bg-dash-blue-glow border border-dash-blue/30 text-dash-blue px-2 py-0.5 rounded-md shadow-sm shrink-0">
              {language}
            </span>
            <span className="text-[10px] font-bold text-dash-blue border border-dash-blue/20 bg-dash-blue/5 px-1.5 sm:px-2 py-0.5 rounded-md shrink-0" title="Your Skill Rating">
              {globalElo} Elo
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
          {/* Daily Tracker Streak Badge */}
          <div className="flex items-center gap-1 bg-dash-bg border border-dash-border rounded-lg px-1.5 sm:px-2 py-1 text-xs text-orange-400" title="Daily Correct Swipes">
            <Flame className="w-3.5 h-3.5 fill-orange-500/10" />
            <span className="font-bold text-[10px] font-mono leading-none">{dailyGoal.correctCount}/10</span>
          </div>

          <button
            onClick={() => setView("swipe")}
            className={`p-1.5 sm:p-2 rounded-lg transition-all border ${view === "swipe" ? "bg-dash-bg text-dash-blue border-dash-border" : "text-dash-muted border-transparent hover:bg-dash-bg hover:text-white"}`}
            title="Card Deck Swiping"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => setView("history")}
            className={`p-1.5 sm:p-2 rounded-lg transition-all border ${view === "history" ? "bg-dash-bg text-dash-blue border-dash-border" : "text-dash-muted border-transparent hover:bg-dash-bg hover:text-white"}`}
            title="History Matrix & SRS Status"
          >
            <div className="relative">
              <History className="w-4 h-4" />
              {srsDueCount > 0 && (
                <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-dash-blue rounded-full animate-ping"></span>
              )}
            </div>
          </button>

          <button
            onClick={() => setView("settings")}
            className={`p-1.5 sm:p-2 rounded-lg transition-all border ${view === "settings" ? "bg-dash-bg text-dash-blue border-dash-border" : "text-dash-muted border-transparent hover:bg-dash-bg hover:text-white"}`}
            title="Training Adjuster Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={() => setView("manual")}
            className={`p-1.5 sm:p-2 rounded-lg transition-all border ${view === "manual" ? "bg-dash-bg text-dash-blue border-dash-border" : "text-dash-muted border-transparent hover:bg-dash-bg hover:text-white"}`}
            title="User Manual & Core Mechanics"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <div className="h-5 w-px bg-dash-border mx-0.5 sm:mx-1"></div>

          <button 
            onClick={handleLogout}
            className="p-1.5 sm:p-2 rounded-lg text-rose-400 hover:bg-dash-surface border border-transparent hover:border-dash-border transition-colors cursor-pointer"
            title="Secure Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* VIEW STACKER */}
      <main className="flex-1 overflow-hidden max-w-lg mx-auto w-full relative flex flex-col justify-between">
        <AnimatePresence mode="wait">
          {view === "swipe" && (
            <motion.div 
              key="swipe"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col overflow-hidden animate-in fade-in"
            >
              <SwipeView 
                deck={deck || []} 
                onAction={handleAction} 
                lastAction={lastAction} 
                onShowModal={() => setShowReviewModal(true)} 
                language={language}
                isGenerating={isGenerating}
                errorTypes={errorTypes}
                skillsMatrix={skillsMatrix}
                synthesisError={synthesisError}
                onLoadOffline={handleLoadOfflineCards}
                onManualRetry={() => generateCards()}
                globalElo={globalElo}
              />
            </motion.div>
          )}

          {view === "history" && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 overflow-hidden animate-in fade-in"
            >
              <HistoryView 
                language={language}
                globalElo={globalElo}
                conceptMastery={conceptMastery}
                unlockedCategories={unlockedCategories}
                categoryUnlockRounds={categoryUnlockRounds}
                srsDueCount={srsDueCount}
                historyList={historyList}
                onReviewCard={(card) => setSelectedHistoryCard(card)}
                styleStats={languageStats[language]?.styleStats || {}}
              />
            </motion.div>
          )}

          {view === "settings" && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 overflow-hidden animate-in fade-in"
            >
              <SettingsView 
                currentLanguage={language}
                currentErrorTypes={errorTypes}
                onSave={handleApplySettings}
                defaultStartingElo={defaultStartingElo}
                onChangeDefaultStartingElo={handleChangeDefaultStartingElo}
                onResetProgress={handleResetLanguageProgress}
              />
            </motion.div>
          )}

          {view === "manual" && (
            <motion.div 
              key="manual"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 overflow-hidden animate-in fade-in"
            >
              <ManualView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* MODALS */}
      {showReviewModal && lastAction && (
        <ReviewModal 
          action={lastAction} 
          language={language} 
          onClose={() => setShowReviewModal(false)} 
        />
      )}

      {selectedHistoryCard && (
        <HistoryReviewModal 
          card={selectedHistoryCard} 
          language={language} 
          onClose={() => setSelectedHistoryCard(null)} 
        />
      )}

      {showGoalModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[#0d1117]/80 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-dash-surface border border-dash-border rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-dash-blue via-dash-green to-dash-blue"></div>
            <Award className="w-16 h-16 text-dash-blue mx-auto mb-4 animate-[bounce_1s_infinite]" />
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Daily Mission Reached!</h2>
            <p className="text-dash-muted text-xs mt-2 leading-relaxed">
              Congratulations! You successfully cleared 10 correct code reviews today. Muscle memory is calibrated correctly.
            </p>
            <button 
              onClick={() => setShowGoalModal(false)}
              className="w-full mt-6 py-3.5 bg-dash-blue hover:bg-dash-blue/90 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 cursor-pointer border border-dash-blue/50 text-xs font-mono uppercase tracking-widest"
            >
              Continue Practice Loop
            </button>
          </motion.div>
        </div>
      )}

      {/* Non-blocking Action Swipe Feedback Pill */}
      <AnimatePresence>
        {actionFeedback && (
          <div className="absolute inset-x-0 top-16 z-50 flex justify-center pointer-events-none px-4 select-none">
            <motion.div
              initial={{ scale: 0.7, opacity: 0, y: -20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -10 }}
              transition={{ type: "spring", damping: 15, stiffness: 220 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-full border shadow-2xl backdrop-blur-md pointer-events-none max-w-[90%] ${
                actionFeedback.isUnsure 
                  ? "bg-amber-600/90 border-amber-500/50 text-white" 
                  : actionFeedback.correct 
                    ? "bg-dash-green/90 border-dash-green/50 text-white" 
                    : "bg-dash-red/90 border-dash-red/50 text-white"
              }`}
            >
              <div className="w-5 h-5 rounded-full flex items-center justify-center border shrink-0 bg-black/20 border-white/20">
                {actionFeedback.isUnsure ? (
                  <HelpCircle className="w-3.5 h-3.5 text-white" />
                ) : actionFeedback.correct ? (
                  <CheckCircle className="w-3.5 h-3.5 text-white" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              
              <div className="flex flex-col text-left leading-none space-y-0.5">
                <span className="text-[11px] font-black font-mono uppercase tracking-wide">
                  {actionFeedback.isUnsure 
                    ? "Not Sure" 
                    : actionFeedback.correct 
                      ? "Correct!" 
                      : "Incorrect!"}
                </span>
                <span className="text-[9px] opacity-90 font-mono tracking-tight">
                  {actionFeedback.eloDiff > 0 ? `+${actionFeedback.eloDiff}` : actionFeedback.eloDiff} ELO ({actionFeedback.newTotalElo} Rating)
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// SwipeView component
function SwipeView(props: {
  deck: Card[];
  onAction: (action: "left" | "right" | "unsure", timeTaken: number) => void;
  lastAction: any;
  onShowModal: () => void;
  language: string;
  isGenerating: boolean;
  errorTypes: string[];
  skillsMatrix: any;
  synthesisError: { message: string; isRateLimit: boolean; isHighDemand?: boolean; retryAfterSeconds: number } | null;
  onLoadOffline: () => void;
  onManualRetry: () => void;
  globalElo: number;
}) {
  const startTimeRef = useRef(Date.now());
  const [dragProgress, setDragProgress] = useState(0); // -100 to 100 for visual stamps
  const [isDrag, setIsDrag] = useState(false);
  const [touchStart, setTouchStart] = useState({ x: 0, y: 0 });

  const currentCard = props.deck[0];
  const topTwo = props.deck.slice(0, 2).reverse();

  // Reset metrics on card change
  useEffect(() => {
    startTimeRef.current = Date.now();
    setDragProgress(0);
  }, [currentCard]);

  const onSelectAction = (action: "left" | "right" | "unsure") => {
    const elapsed = Date.now() - startTimeRef.current;
    props.onAction(action, elapsed);
  };

  // Unified Touch & Mouse Gesture Drag Handling
  const handleDragStart = (clientX: number, clientY: number) => {
    setTouchStart({ x: clientX, y: clientY });
    setIsDrag(true);
  };

  const handleDragMove = (clientX: number) => {
    if (!isDrag) return;
    const diffX = clientX - touchStart.x;
    const mapped = Math.max(-100, Math.min(100, (diffX / 120) * 100));
    setDragProgress(mapped);
  };

  const handleDragEnd = () => {
    if (!isDrag) return;
    setIsDrag(false);
    if (dragProgress > 60) {
      onSelectAction("right");
    } else if (dragProgress < -60) {
      onSelectAction("left");
    }
    setDragProgress(0);
  };

  const touchStartWrapper = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.no-swipe')) return;
    handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
  };

  const touchMoveWrapper = (e: React.TouchEvent) => {
    handleDragMove(e.touches[0].clientX);
  };

  const mouseDownWrapper = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left clicks only
    if ((e.target as HTMLElement).closest('.no-swipe')) return;
    handleDragStart(e.clientX, e.clientY);
  };

  const mouseMoveWrapper = (e: React.MouseEvent) => {
    handleDragMove(e.clientX);
  };

  return (
    <div className="flex-1 flex flex-col justify-between p-4 overflow-hidden">
      
      {/* Card stack layout */}
      <div className="flex-1 relative w-full flex items-center justify-center my-2 select-none">
        {props.deck.length > 0 ? (
          topTwo.map((card, idx, arr) => {
            const isTop = card.id === currentCard.id;
            // Fallback key to avoid React duplicate key exceptions (e.g. if database has historic duplicate IDs)
            const hasDuplicateId = arr.some((c, cIdx) => c.id === card.id && cIdx !== idx);
            const cardKey = hasDuplicateId ? `${card.id}_${idx}` : card.id;
            
             return (
              <div
                key={cardKey}
                style={{
                  transform: isTop 
                    ? `translateX(${dragProgress * 1.5}px) rotate(${dragProgress * 0.08}deg)` 
                    : `scale(0.96) translateY(12px)`,
                  zIndex: isTop ? 10 : 5,
                  opacity: isTop ? 1 : 0.45
                }}
                onTouchStart={isTop ? touchStartWrapper : undefined}
                onTouchMove={isTop ? touchMoveWrapper : undefined}
                onTouchEnd={isTop ? handleDragEnd : undefined}
                onMouseDown={isTop ? mouseDownWrapper : undefined}
                onMouseMove={isTop ? mouseMoveWrapper : undefined}
                onMouseUp={isTop ? handleDragEnd : undefined}
                onMouseLeave={isTop ? handleDragEnd : undefined}
                className={`absolute inset-0 bg-dash-surface border border-dash-border rounded-2xl flex flex-col overflow-hidden shadow-2xl transition-all duration-75 ${isTop ? "cursor-grab active:cursor-grabbing select-none" : ""}`}
              >
                {/* Visual Swiped Status Stamps */}
                {isTop && dragProgress > 25 && (
                  <div className="absolute top-10 left-10 border-4 border-dash-green text-dash-green font-extrabold font-mono text-xl p-2 rounded-lg rotate-[-12deg] z-40 bg-[#0d1117]/90 uppercase tracking-widest shadow-lg">
                    SWIPE CORRECT
                  </div>
                )}
                {isTop && dragProgress < -25 && (
                  <div className="absolute top-10 right-10 border-4 border-dash-red text-dash-red font-extrabold font-mono text-xl p-2 rounded-lg rotate-[12deg] z-40 bg-[#0d1117]/90 uppercase tracking-widest shadow-lg">
                    SWIPE BUGGY
                  </div>
                )}

                {/* Header context (Upper Half Drag Handle Trigger) */}
                <div 
                  onTouchStart={isTop ? touchStartWrapper : undefined}
                  onTouchMove={isTop ? touchMoveWrapper : undefined}
                  onTouchEnd={isTop ? handleDragEnd : undefined}
                  onMouseDown={isTop ? mouseDownWrapper : undefined}
                  onMouseMove={isTop ? mouseMoveWrapper : undefined}
                  onMouseUp={isTop ? handleDragEnd : undefined}
                  onMouseLeave={isTop ? handleDragEnd : undefined}
                  className={`p-4 border-b border-dash-border bg-[#1c2128] shrink-0 ${isTop ? "cursor-grab active:cursor-grabbing select-none" : ""}`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-mono tracking-widest uppercase text-dash-muted">Target Objective</span>
                    <span className="text-[11px] font-mono font-bold text-dash-blue bg-dash-blue/5 border border-dash-blue/15 px-1.5 py-0.5 rounded">{card.funcName}()</span>
                  </div>
                  <p className="text-xs text-dash-text mt-2 font-mono leading-relaxed bg-[#0d1117] p-2.5 rounded-lg border border-dash-border">
                    "{card.docstring}"
                  </p>
                </div>

                {/* Main scrollable code body */}
                <div className="flex-1 overflow-auto bg-[#0d1117] p-4 text-left relative no-swipe border-t border-[#1c2128] select-text">
                  <HighlightedCode code={card.code} language={props.language} shouldStripComments={true} />
                </div>

                {/* Bottom drag handlebar */}
                <div
                  onTouchStart={isTop ? touchStartWrapper : undefined}
                  onTouchMove={isTop ? touchMoveWrapper : undefined}
                  onTouchEnd={isTop ? handleDragEnd : undefined}
                  onMouseDown={isTop ? mouseDownWrapper : undefined}
                  onMouseMove={isTop ? mouseMoveWrapper : undefined}
                  onMouseUp={isTop ? handleDragEnd : undefined}
                  onMouseLeave={isTop ? handleDragEnd : undefined}
                  className={`py-2 px-4 border-t border-dash-border bg-[#1c2128] flex justify-between items-center shrink-0 h-9 font-mono text-[9px] text-[#8b949e] ${isTop ? "cursor-grab active:cursor-grabbing select-none" : ""}`}
                >
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-dash-blue/60 animate-pulse"></span>
                    DRAG TO DECIDE
                  </span>
                  <div className="flex gap-1 items-center py-1 select-none">
                    <div className="w-6 h-0.5 bg-dash-border/80 rounded-full"></div>
                    <div className="w-6 h-0.5 bg-dash-border/80 rounded-full"></div>
                  </div>
                  <span>
                    BUGGY ◄ ► CLEAN
                  </span>
                </div>
              </div>
            );
          })
        ) : props.synthesisError ? (
          <div className="flex flex-col items-center justify-center p-6 border border-dash-red/30 bg-[#0d1117] rounded-2xl w-full h-full text-center relative overflow-hidden select-text">
            {/* Red glow accent bar */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-dash-red via-orange-500 to-dash-red"></div>
            
            <AlertTriangle className="w-12 h-12 text-dash-red mb-3 animate-[pulse_2s_infinite]" />
            <h3 className="font-extrabold text-sm text-[#ffffff] tracking-wide font-mono uppercase">
              {props.synthesisError.isHighDemand 
                ? "Gemini High Demand (503)" 
                : props.synthesisError.isRateLimit 
                  ? "Gemini Quota Exceeded (429)" 
                  : "Error Contacting Gemini"}
            </h3>
            
            <p className="text-xs text-dash-muted mt-2 max-w-xs leading-relaxed font-mono">
              {props.synthesisError.isHighDemand
                ? "The Gemini engine is experiencing transient high request demand. Spikes are temporary—offline practice handles this instantly."
                : props.synthesisError.isRateLimit 
                  ? "The Gemini Free Tier is currently rate-limited (20 requests/day). Don't worry, you can continue practice immediately in offline mode!"
                  : props.synthesisError.message || "An unexpected error occurred while communicating with the card synthesizer."}
            </p>

            {props.synthesisError.isRateLimit && props.synthesisError.retryAfterSeconds > 0 && (
              <div className="mt-4 px-3 py-1.5 bg-[#8a1c1d]/10 border border-[#8a1c1d]/20 text-dash-red rounded-lg font-mono text-[11px] flex items-center gap-1.5 justify-center">
                <Clock className="w-4 h-4 animate-spin-reverse" />
                <span>Auto-Retry in: <strong className="text-white text-xs">{props.synthesisError.retryAfterSeconds}s</strong></span>
              </div>
            )}

            <div className="flex flex-col gap-2 w-full mt-6 max-w-xs">
              <button
                onClick={props.onLoadOffline}
                className="w-full py-2.5 bg-gradient-to-r from-dash-blue to-indigo-600 hover:from-dash-blue/95 hover:to-indigo-600/95 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer border border-dash-blue/30 text-[11px] font-mono uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-cyan-300 animate-[pulse_1s_infinite]" />
                ⚡ Load Offline Training Mode
              </button>

              <button
                onClick={props.onManualRetry}
                disabled={props.synthesisError.isRateLimit && props.synthesisError.retryAfterSeconds > 0}
                className={`w-full py-2 rounded-lg border text-[10px] font-mono uppercase tracking-widest cursor-pointer transition ${
                  props.synthesisError.isRateLimit && props.synthesisError.retryAfterSeconds > 0
                    ? "bg-[#21262d] border-[#30363d] text-dash-muted cursor-not-allowed opacity-50"
                    : "bg-dash-surface border-[#30363d] hover:bg-dash-bg text-white hover:border-dash-blue/40"
                }`}
              >
                🔄 Try Synthesizing Again
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed border-dash-border bg-dash-surface rounded-2xl w-full h-full text-center">
            <div className="relative mb-4">
              <div className="w-12 h-12 border-4 border-dash-blue/20 border-t-dash-blue rounded-full animate-spin"></div>
            </div>
            <h3 className="font-extrabold text-sm text-[#ffffff] tracking-wide font-mono uppercase">Synthesizing Fresh Challenges</h3>
            <p className="text-xs text-dash-muted mt-2 max-w-xs leading-relaxed">
              Gemini is auditing telemetry levels to generate specific code layouts based on your learning criteria.
            </p>
          </div>
        )}
      </div>

      {/* Swipe Actions Menu */}
      <div className="shrink-0 pt-2 z-30 relative flex flex-col space-y-3">
        {/* Undo / explanation button */}
        {props.lastAction && (
          <div className="flex justify-between items-center px-1 font-mono">
            <span className={`text-[10px] tracking-wider uppercase font-bold px-2.5 py-1 rounded border-l-4 ${
              props.lastAction.actionType === "unsure" 
                ? "bg-dash-surface border-dash-border text-dash-muted border-l-dash-muted" 
                : props.lastAction.userGuessedCorrectly 
                  ? "bg-dash-green/10 border-dash-border text-dash-green border-l-dash-green" 
                  : "bg-dash-red/10 border-dash-border text-dash-red border-l-dash-red"
            }`}>
              {props.lastAction.actionType === "unsure" 
                ? "🤷 Not Sure" 
                : props.lastAction.userGuessedCorrectly 
                  ? "✓ Correct!" 
                  : "✗ Incorrect"}
            </span>
            <button
              onClick={props.onShowModal}
              className="px-2.5 py-1 text-[11px] font-bold border border-dash-border hover:border-dash-blue/30 text-white rounded bg-dash-surface shadow active:scale-95 flex items-center gap-1.5 cursor-pointer hover:bg-dash-bg transition"
            >
              Analyze Snippet
              <ChevronRight className="w-3.5 h-3.5 text-dash-blue" />
            </button>
          </div>
        )}

        {/* Swipe control bottoms - conforming to SaaS/Technical buttons */}
        <div className="flex justify-between items-center gap-2">
          <button
            onClick={() => onSelectAction("left")}
            disabled={props.deck.length === 0}
            className="flex-1 h-12 rounded-xl bg-dash-red hover:bg-dash-red/90 text-white active:scale-95 transition-all text-xs font-black tracking-widest font-mono uppercase cursor-pointer border border-[#8a1c1d]"
          >
            ❌ BUGGY
          </button>
          
          <button
            onClick={() => onSelectAction("unsure")}
            disabled={props.deck.length === 0}
            className="px-6 h-12 rounded-xl bg-[#21262d] hover:bg-dash-surface border border-dash-border text-dash-text active:scale-95 transition-all text-xs font-black tracking-wider font-mono cursor-pointer flex items-center justify-center min-w-[72px] shrink-0"
            title="Unsure / Knowledge Gap Retry"
          >
            IDK
          </button>

          <button
            onClick={() => onSelectAction("right")}
            disabled={props.deck.length === 0}
            className="flex-1 h-12 rounded-xl bg-dash-green hover:bg-dash-green/90 text-white active:scale-95 transition-all text-xs font-black tracking-widest font-mono uppercase cursor-pointer border border-[#1b6b2b]"
          >
            ✅ LGTM
          </button>
        </div>
      </div>
    </div>
  );
}

// History matrix and attempting list view
function HistoryView(props: {
  language: string;
  globalElo: number;
  conceptMastery: Record<string, number>;
  unlockedCategories: string[];
  categoryUnlockRounds: Record<string, number>;
  srsDueCount: number;
  historyList: Attempt[];
  onReviewCard: (card: Attempt) => void;
  styleStats: Record<string, { solved: number; failed: number; unsure: number }>;
}) {
  const [activeTab, setActiveTab] = useState<"matrix" | "history">("matrix");

  const getRankName = (elo: number) => {
    if (elo < 1000) return "Novice Auditor";
    if (elo < 1400) return "Intermediate Engineer";
    if (elo < 1800) return "Advanced Security Auditor";
    return "Lead Architect";
  };

  const getCategoryAvg = (cat: string) => {
    const tags = Object.keys(TAG_CATEGORIES).filter(k => TAG_CATEGORIES[k] === cat);
    if (tags.length === 0) return 1.0;
    const mods = tags.map(t => props.conceptMastery[t] !== undefined ? props.conceptMastery[t] : 1.0);
    return parseFloat((mods.reduce((s, x) => s + x, 0) / mods.length).toFixed(2));
  };

  return (
    <div className="p-4 space-y-4 h-full flex flex-col overflow-hidden">
      
      {/* Tabs */}
      <div className="flex bg-[#21262d] p-1 rounded-lg border border-dash-border shrink-0 select-none">
        <button
          onClick={() => setActiveTab("matrix")}
          className={`flex-1 py-1.5 text-xs font-bold font-mono uppercase rounded transition-all cursor-pointer ${activeTab === "matrix" ? "bg-dash-surface text-dash-blue border border-dash-border/40 shadow-sm" : "text-dash-muted hover:text-white"}`}
        >
          RPG Stats Dashboard
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 py-1.5 text-xs font-bold font-mono uppercase rounded transition-all cursor-pointer ${activeTab === "history" ? "bg-dash-surface text-dash-blue border border-dash-border/40 shadow-sm" : "text-dash-muted hover:text-white"}`}
        >
          Review Logs ({props.historyList.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-0.5 space-y-4 no-swipe">
        {activeTab === "matrix" && (
          <div className="space-y-4">
            
            {/* Global ELO Rank Card */}
            <div className="bg-dash-surface border border-dash-border rounded-xl p-4 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-dash-blue via-dash-green to-dash-blue"></div>
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono tracking-wider text-dash-muted uppercase">Your {props.language} Standing</span>
                  <p className="text-2xl font-black text-white font-mono leading-none">{props.globalElo} ELO</p>
                  <p className="text-xs font-semibold text-dash-blue tracking-wide">{getRankName(props.globalElo)}</p>
                </div>
                <Award className="w-10 h-10 text-dash-blue/40" />
              </div>
              
              {/* ELO Progress visual scale */}
              <div className="mt-4 space-y-1">
                <div className="flex justify-between text-[9px] font-mono text-dash-muted uppercase">
                  <span>Beginner (800)</span>
                  <span>1200</span>
                  <span>1600</span>
                  <span>Expert (2000)</span>
                </div>
                <div className="relative h-2 bg-dash-bg border border-dash-border rounded-full overflow-hidden">
                  <div 
                    className="absolute h-full bg-gradient-to-r from-dash-blue to-dash-green transition-all" 
                    style={{ width: `${Math.min(100, Math.max(5, ((props.globalElo - 800) / (2000 - 800)) * 100))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* SRS backlogged info */}
            <div className="bg-dash-surface border border-dash-border border-l-4 border-l-dash-blue rounded-xl p-4 flex justify-between items-center shadow-lg">
              <div>
                <h3 className="text-xs font-mono font-bold tracking-widest text-[#ffffff] uppercase">Spaced Repetition Queue</h3>
                <p className="text-[10px] text-dash-muted mt-1 leading-relaxed">Sister variants scheduled for dynamic repetition consolidation.</p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black font-mono text-dash-blue leading-none">{props.srsDueCount}</span>
                <p className="text-[8px] uppercase tracking-wider font-mono text-dash-muted mt-0.5">Due Now</p>
              </div>
            </div>

            {/* Category unlocked rollout states */}
            <div className="bg-dash-surface border border-dash-border rounded-xl p-4 space-y-3">
              <h3 className="text-[10px] font-black font-mono uppercase tracking-widest text-dash-muted flex items-center gap-1.5 border-b border-dash-border pb-2">
                <Sparkles className="w-3.5 h-3.5 text-dash-blue" />
                Macro Category Unlock Matrix
              </h3>
              
              <div className="space-y-3.5 font-mono text-[11px]">
                {/* Logical */}
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-white font-bold uppercase">1. Logic Taxonomy</span>
                    <p className="text-[9px] text-dash-muted">Average mastery: {getCategoryAvg("Logic").toFixed(2)}x</p>
                  </div>
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-dash-green/10 border border-dash-green/20 text-dash-green">FULLY UNLOCKED</span>
                </div>

                {/* Performance */}
                <div className="flex justify-between items-center border-t border-dash-border/40 pt-2.5">
                  <div>
                    <span className="text-white font-bold uppercase">2. Performance Taxonomy</span>
                    <p className="text-[9px] text-dash-muted">
                      {props.unlockedCategories.includes("Performance") 
                        ? `Average mastery: ${getCategoryAvg("Performance").toFixed(2)}x`
                        : "Requires average Logic mastery > 1.20x"}
                    </p>
                  </div>
                  {props.unlockedCategories.includes("Performance") ? (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                      props.categoryUnlockRounds["Performance"] !== undefined && props.categoryUnlockRounds["Performance"] <= 20
                        ? "bg-amber-400/10 border border-amber-400/20 text-amber-400"
                        : "bg-dash-green/10 border border-dash-green/20 text-dash-green"
                    }`}>
                      {props.categoryUnlockRounds["Performance"] !== undefined && props.categoryUnlockRounds["Performance"] <= 20
                        ? `SLOW ROLLOUT (${props.categoryUnlockRounds["Performance"]}/20)`
                        : "INTEGRATED"}
                    </span>
                  ) : (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#21262d] border border-dash-border text-dash-muted">LOCKED</span>
                  )}
                </div>

                {/* Security */}
                <div className="flex justify-between items-center border-t border-dash-border/40 pt-2.5">
                  <div>
                    <span className="text-white font-bold uppercase">3. Security Taxonomy</span>
                    <p className="text-[9px] text-dash-muted">
                      {props.unlockedCategories.includes("Security") 
                        ? `Average mastery: ${getCategoryAvg("Security").toFixed(2)}x`
                        : "Requires average Performance mastery > 1.20x"}
                    </p>
                  </div>
                  {props.unlockedCategories.includes("Security") ? (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                      props.categoryUnlockRounds["Security"] !== undefined && props.categoryUnlockRounds["Security"] <= 20
                        ? "bg-amber-400/10 border border-amber-400/20 text-amber-400"
                        : "bg-dash-green/10 border border-dash-green/20 text-dash-green"
                    }`}>
                      {props.categoryUnlockRounds["Security"] !== undefined && props.categoryUnlockRounds["Security"] <= 20
                        ? `SLOW ROLLOUT (${props.categoryUnlockRounds["Security"]}/20)`
                        : "INTEGRATED"}
                    </span>
                  ) : (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#21262d] border border-dash-border text-dash-muted">LOCKED</span>
                  )}
                </div>

                {/* Architecture */}
                <div className="flex justify-between items-center border-t border-dash-border/40 pt-2.5">
                  <div>
                    <span className="text-white font-bold uppercase">4. Architecture Taxonomy</span>
                    <p className="text-[9px] text-dash-muted">
                      {props.unlockedCategories.includes("Architecture") 
                        ? `Average mastery: ${getCategoryAvg("Architecture").toFixed(2)}x`
                        : "Requires average Security mastery > 1.20x"}
                    </p>
                  </div>
                  {props.unlockedCategories.includes("Architecture") ? (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                      props.categoryUnlockRounds["Architecture"] !== undefined && props.categoryUnlockRounds["Architecture"] <= 20
                        ? "bg-amber-400/10 border border-amber-400/20 text-amber-400"
                        : "bg-dash-green/10 border border-dash-green/20 text-dash-green"
                    }`}>
                      {props.categoryUnlockRounds["Architecture"] !== undefined && props.categoryUnlockRounds["Architecture"] <= 20
                        ? `SLOW ROLLOUT (${props.categoryUnlockRounds["Architecture"]}/20)`
                        : "INTEGRATED"}
                    </span>
                  ) : (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#21262d] border border-dash-border text-dash-muted">LOCKED</span>
                  )}
                </div>
              </div>
            </div>

            {/* Subclass Concept Tags RPG Stat Sheets */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold font-mono uppercase tracking-widest text-dash-muted">Subclass Concept Tag Mastery</h3>
              
              {props.unlockedCategories.map(cat => (
                <div key={cat} className="bg-dash-surface border border-dash-border rounded-xl p-3.5 space-y-2.5">
                  <h4 className="font-extrabold text-[#ffffff] border-b border-dash-border/60 pb-1.5 flex justify-between items-center font-mono uppercase text-[11px] tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-dash-blue"></span>
                      {cat} Category
                    </span>
                    <span className="text-[10px] text-dash-blue font-mono font-bold">Avg: {getCategoryAvg(cat).toFixed(2)}x</span>
                  </h4>
                  
                  <div className="grid grid-cols-1 gap-2">
                    {(TAG_CATEGORIES_REVERSE[cat] || []).map(tag => {
                      const mod = props.conceptMastery[tag] !== undefined ? props.conceptMastery[tag] : 1.0;
                      
                      let badgeColor = "bg-dash-blue/5 border-dash-blue/20 text-dash-blue";
                      let badgeText = "STABLE";
                      if (mod > 1.20) {
                        badgeColor = "bg-dash-green/10 border-dash-green/20 text-dash-green font-black";
                        badgeText = "MASTER ⭐";
                      } else if (mod < 1.00) {
                        badgeColor = "bg-dash-red/10 border-dash-red/25 text-dash-red";
                        badgeText = "GAP WARNING";
                      }

                      return (
                        <div key={tag} className="flex justify-between items-center p-2 bg-dash-bg border border-dash-border rounded-lg text-xs font-mono">
                          <span className="font-semibold text-white">#{tag}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded leading-none border">{mod.toFixed(2)}x modifier</span>
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${badgeColor}`}>
                              {badgeText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Authorship Style Proficiencies */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold font-mono uppercase tracking-widest text-dash-muted">Authorship Style Proficiencies</h3>
              
              {(() => {
                const support = LANGUAGE_STYLE_SUPPORT[props.language] || {
                  iteration: ["imperative", "recursive"],
                  conditional: ["imperative-branching"]
                };

                return (
                  <div className="bg-dash-surface border border-dash-border rounded-xl p-3.5 space-y-4">
                    {/* Iteration Styles Section */}
                    <div>
                      <h4 className="font-extrabold text-[#ffffff] border-b border-dash-border/60 pb-1.5 flex justify-between items-center font-mono uppercase text-[11px] tracking-wider mb-2.5">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-dash-blue animate-pulse"></span>
                          Iteration Styles
                        </span>
                      </h4>
                      
                      <div className="grid grid-cols-1 gap-2.5">
                        {support.iteration.map(style => {
                          const stats = props.styleStats[style] || { solved: 0, failed: 0, unsure: 0 };
                          const total = stats.solved + stats.failed + stats.unsure;
                          const accuracy = total > 0 ? Math.round((stats.solved / (stats.solved + stats.failed)) * 100) : null;

                          let labelText = style;
                          if (style === "imperative") labelText = "imperative (manual loops)";
                          if (style === "for-each") labelText = "for-each (value-based)";
                          if (style === "functional-pipeline") labelText = "functional-pipeline (map/filter)";
                          if (style === "fold-reduce") labelText = "fold-reduce (state-accumulating)";
                          if (style === "recursive") labelText = "recursive";

                          return (
                            <div key={style} className="p-3 bg-dash-bg border border-dash-border rounded-lg text-xs font-mono space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-white tracking-tight">{labelText}</span>
                                <span className="text-[10px] text-dash-blue font-bold">
                                  {accuracy !== null ? `${accuracy}% ACC` : "0 RUNS"}
                                </span>
                              </div>
                              
                              <div className="flex justify-between items-center text-[10px] text-dash-muted">
                                <span>Solved: {stats.solved}</span>
                                <span>Failed: {stats.failed}</span>
                                <span>Unsure: {stats.unsure}</span>
                              </div>

                              {total > 0 && (
                                <div className="w-full bg-[#21262d] h-1.5 rounded-full overflow-hidden flex">
                                  <div 
                                    style={{ width: `${(stats.solved / total) * 100}%` }} 
                                    className="bg-dash-green h-full"
                                  />
                                  <div 
                                    style={{ width: `${(stats.failed / total) * 100}%` }} 
                                    className="bg-dash-red h-full"
                                  />
                                  <div 
                                    style={{ width: `${(stats.unsure / total) * 100}%` }} 
                                    className="bg-[#fed7aa]/35 h-full"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Conditional Styles Section */}
                    <div>
                      <h4 className="font-extrabold text-[#ffffff] border-b border-dash-border/60 pb-1.5 flex justify-between items-center font-mono uppercase text-[11px] tracking-wider mb-2.5">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                          Conditional Styles
                        </span>
                      </h4>
                      
                      <div className="grid grid-cols-1 gap-2.5">
                        {support.conditional.map(style => {
                          const stats = props.styleStats[style] || { solved: 0, failed: 0, unsure: 0 };
                          const total = stats.solved + stats.failed + stats.unsure;
                          const accuracy = total > 0 ? Math.round((stats.solved / (stats.solved + stats.failed)) * 100) : null;

                          let labelText = style;
                          if (style === "imperative-branching") labelText = "imperative branching (if/else)";
                          if (style === "pattern-matching") labelText = "pattern-matching";

                          return (
                            <div key={style} className="p-3 bg-dash-bg border border-dash-border rounded-lg text-xs font-mono space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-white tracking-tight">{labelText}</span>
                                <span className="text-[10px] text-indigo-400 font-bold">
                                  {accuracy !== null ? `${accuracy}% ACC` : "0 RUNS"}
                                </span>
                              </div>
                              
                              <div className="flex justify-between items-center text-[10px] text-dash-muted">
                                <span>Solved: {stats.solved}</span>
                                <span>Failed: {stats.failed}</span>
                                <span>Unsure: {stats.unsure}</span>
                              </div>

                              {total > 0 && (
                                <div className="w-full bg-[#21262d] h-1.5 rounded-full overflow-hidden flex">
                                  <div 
                                    style={{ width: `${(stats.solved / total) * 100}%` }} 
                                    className="bg-dash-green h-full"
                                  />
                                  <div 
                                    style={{ width: `${(stats.failed / total) * 100}%` }} 
                                    className="bg-dash-red h-full"
                                  />
                                  <div 
                                    style={{ width: `${(stats.unsure / total) * 100}%` }} 
                                    className="bg-[#fed7aa]/35 h-full"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Idiom Styles Section */}
                    <div>
                      <h4 className="font-extrabold text-[#ffffff] border-b border-dash-border/60 pb-1.5 flex justify-between items-center font-mono uppercase text-[11px] tracking-wider mb-2.5">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          Idiom Styles
                        </span>
                      </h4>
                      
                      <div className="grid grid-cols-1 gap-2.5">
                        {["standard", "idiomatic", "obscure"].map(style => {
                          const stats = props.styleStats[style] || { solved: 0, failed: 0, unsure: 0 };
                          const total = stats.solved + stats.failed + stats.unsure;
                          const accuracy = total > 0 ? Math.round((stats.solved / (stats.solved + stats.failed)) * 100) : null;

                          let labelText = style;
                          if (style === "standard") labelText = "standard (general patterns)";
                          if (style === "idiomatic") labelText = "idiomatic (language shorthand)";
                          if (style === "obscure") labelText = "obscure (clever hacks)";

                          return (
                            <div key={style} className="p-3 bg-dash-bg border border-dash-border rounded-lg text-xs font-mono space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-white tracking-tight">{labelText}</span>
                                <span className="text-[10px] text-amber-500 font-bold">
                                  {accuracy !== null ? `${accuracy}% ACC` : "0 RUNS"}
                                </span>
                              </div>
                              
                              <div className="flex justify-between items-center text-[10px] text-dash-muted">
                                <span>Solved: {stats.solved}</span>
                                <span>Failed: {stats.failed}</span>
                                <span>Unsure: {stats.unsure}</span>
                              </div>

                              {total > 0 && (
                                <div className="w-full bg-[#21262d] h-1.5 rounded-full overflow-hidden flex">
                                  <div 
                                    style={{ width: `${(stats.solved / total) * 100}%` }} 
                                    className="bg-dash-green h-full"
                                  />
                                  <div 
                                    style={{ width: `${(stats.failed / total) * 100}%` }} 
                                    className="bg-dash-red h-full"
                                  />
                                  <div 
                                    style={{ width: `${(stats.unsure / total) * 100}%` }} 
                                    className="bg-[#fed7aa]/35 h-full"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                );
              })()}
            </div>

          </div>
        )}

        {/* Swiping history logger */}
        {activeTab === "history" && (
          <div className="space-y-2">
            {props.historyList.length === 0 ? (
               <div className="text-center p-8 bg-dash-surface/40 border border-dash-border rounded-xl">
                <p className="text-xs font-mono text-dash-muted">No runs logged yet. Complete standard sweeps to calibrate telemetry logs.</p>
              </div>
            ) : (
              props.historyList.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => props.onReviewCard(item)}
                  className="bg-dash-surface hover:bg-[#1c2128]/70 border border-dash-border p-3 rounded-xl cursor-pointer transition-all flex justify-between items-center"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-white">{item.funcName}()</span>
                      <span className="text-[8px] font-mono font-bold bg-[#21262d] text-dash-muted border border-dash-border px-1.5 py-0.5 rounded uppercase">{item.language}</span>
                      <span className="text-[8px] font-mono font-extrabold text-dash-blue bg-dash-blue/5 border border-dash-blue/20 px-1.5 py-0.5 rounded">{item.baseElo || 800} ELO</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[10px] font-mono text-dash-muted line-clamp-1">"{item.docstring}"</p>
                      {item.tags && item.tags.map(tag => (
                        <span key={tag} className="text-[8px] text-dash-green font-mono shrink-0">#{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[8px] font-mono font-black px-1.5 py-0.5 rounded uppercase border ${
                      item.swipedType === "unsure" 
                        ? "bg-dash-surface border-dash-border text-dash-muted" 
                        : item.userGuessedCorrectly 
                          ? "bg-dash-green/15 border-dash-green/30 text-dash-green" 
                          : "bg-dash-red/15 border-dash-red/30 text-dash-red"
                    }`}>
                      {item.swipedType === "unsure" 
                        ? "UNSURE" 
                        : item.userGuessedCorrectly 
                          ? "CORRECT" 
                          : "OVERVIEW"}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-dash-muted" />
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Manual Operators View
function ManualView() {
  return (
    <div className="p-4 space-y-6 h-full flex flex-col justify-between overflow-y-auto no-swipe text-dash-text font-sans">
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-extrabold font-mono tracking-widest text-[#ffffff] uppercase flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-dash-blue" /> Operator Manual
          </h2>
          <p className="text-xs text-dash-muted mt-1 leading-relaxed">
            Accelerated syntax calibration and code evaluation console
          </p>
        </div>

        {/* Purpose */}
        <div className="bg-dash-surface border border-dash-border rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-dash-blue flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-dash-blue" /> Purpose
          </h3>
          <p className="text-xs text-dash-text leading-relaxed">
            CODESWIPE PRO is designed to calibrate your software engineering instincts. By presenting rapid-fire code blocks, it trains your optical search and cognitive pattern matching to spot real-world code defects in seconds.
          </p>
        </div>

        {/* How It Works */}
        <div className="bg-dash-surface border border-dash-border rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-dash-blue flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-dash-blue" /> Core Mechanics
          </h3>
          <div className="space-y-2 text-xs">
            <p className="leading-relaxed">
              Upon entering the console, you are met with visual code cards dynamically simulated or requested via an interactive queue. Evaluate the snippet and make your decision:
            </p>
            <div className="grid grid-cols-1 gap-2 pt-1 font-mono">
              <div className="flex items-start gap-2 bg-dash-bg border border-dash-border/40 p-2.5 rounded-lg">
                <span className="text-dash-red font-black shrink-0 text-[10px]">← LEFT [INCORRECT]</span>
                <span className="text-dash-muted text-[11px] leading-snug">The code contains a deliberate bug (syntax, type mismatch, runtime flaw, etc.).</span>
              </div>
              <div className="flex items-start gap-2 bg-dash-bg border border-dash-border/40 p-2.5 rounded-lg">
                <span className="text-dash-green font-black shrink-0 text-[10px]">RIGHT [CORRECT] →</span>
                <span className="text-dash-muted text-[11px] leading-snug">The code is clean, syntactically sound, and executes properly without bugs.</span>
              </div>
              <div className="flex items-start gap-2 bg-dash-bg border border-dash-border/40 p-2.5 rounded-lg">
                <span className="text-dash-blue font-black shrink-0 text-[10px]">CENTER [IDK]</span>
                <span className="text-dash-muted text-[11px] leading-snug">Unsure or have a knowledge gap? Skip without affecting your Elo; scheduled for near-future retry.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Settings, Language, and Progress */}
        <div className="bg-dash-surface border border-dash-border rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-dash-blue flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5 text-dash-blue" /> Preferences & Alignment
          </h3>
          <p className="text-xs text-dash-text leading-relaxed">
            Tap the <strong className="text-white">Settings</strong> gear in the top right header to optimize your training parameters:
          </p>
          <ul className="list-disc pl-4 space-y-1.5 text-xs text-dash-muted leading-relaxed">
            <li><strong className="text-white">Switch Languages:</strong> Adjust the target programming language immediately to train in Python, JavaScript, Rust, C++, C#, Kotlin, Java, and more.</li>
            <li><strong className="text-white">Custom Focus:</strong> Filter down or combine targeted error formats (e.g. only inspect logic bugs or runtime constraints).</li>
            <li><strong className="text-white">Reset Progress:</strong> Erase previous diagnostic runs and baseline your training Elo to entry level (800 Elo), intermediate (1000 Elo), or master (1200 Elo).</li>
          </ul>
        </div>

        {/* Adaptive Difficulty */}
        <div className="bg-dash-surface border border-dash-border rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#5df3ff] flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-dash-blue" /> Adaptive Elo Matchmaking
          </h3>
          <p className="text-xs text-dash-muted leading-relaxed">
            The platform is driven by structured calibration. As you verify correct responses, your <strong className="text-white">Elo Rating</strong> rises. High Elo levels expand the code synthesis pool, introducing advanced design patterns, intricate functional structures, complex concurrency bugs, and exotic syntax variations.
          </p>
        </div>

        {/* References */}
        <div className="bg-dash-surface border border-dash-border rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-dash-blue flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-dash-blue" /> References
          </h3>
          <div className="space-y-3.5 text-xs">
            <div className="border-l-2 border-dash-blue/30 pl-3 py-0.5">
              <p className="text-white font-medium leading-relaxed">
                Zi, Y., Li, L., Guha, A., Anderson, C. J., & Feldman, M. Q. (2025). "I Would Have Written My Code Differently”: Beginners Struggle to Understand LLM-Generated Code. <em>arXiv</em>.
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px]">
                <a 
                  href="https://doi.org/10.1145/3696630.3731663" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-dash-blue hover:underline font-mono"
                >
                  doi:10.1145/3696630.3731663
                </a>
                <span className="text-dash-muted">•</span>
                <span className="text-dash-blue font-mono bg-dash-blue/5 border border-dash-blue/10 px-1.5 py-0.2 rounded text-[10px]">
                  Cited by: 8
                </span>
              </div>
            </div>

            <div className="border-l-2 border-dash-blue/30 pl-3 py-0.5">
              <p className="text-white font-medium leading-relaxed">
                Pankiewicz, M., & Bator, M. (2019). Elo Rating Algorithm for the Purpose of Measuring Task Difficulty in Online Learning Environments. <em>e-mentor</em>, 82, 43–51.
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px]">
                <a 
                  href="https://doi.org/10.15219/em82.1444" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-dash-blue hover:underline font-mono"
                >
                  doi:10.15219/em82.1444
                </a>
                <span className="text-dash-muted">•</span>
                <span className="text-dash-blue font-mono bg-dash-blue/5 border border-dash-blue/10 px-1.5 py-0.2 rounded text-[10px]">
                  Cited by: 91
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center pt-2 pb-4">
        <p className="text-[10px] text-dash-muted font-mono uppercase tracking-widest">CodeSwipe Pro • Manual Rev 1.4</p>
      </div>
    </div>
  );
}

// Adjust Settings View
function SettingsView(props: {
  currentLanguage: string;
  currentErrorTypes: string[];
  onSave: (lang: string, errs: string[]) => void;
  defaultStartingElo: number;
  onChangeDefaultStartingElo: (val: number) => void;
  onResetProgress: (startingElo: number) => void;
}) {
  const [lang, setLang] = useState(props.currentLanguage);
  const [focusedErrs, setFocusedErrs] = useState<string[]>(props.currentErrorTypes);
  const [confirmReset, setConfirmReset] = useState(false);

  const toggleErr = (err: string) => {
    setFocusedErrs(prev => {
      const next = prev.includes(err) ? prev.filter(e => e !== err) : [...prev, err];
      return next.length === 0 ? [err] : next; // Require at least 1 focus
    });
  };

  return (
    <div className="p-4 space-y-6 h-full flex flex-col justify-between overflow-y-auto no-swipe">
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-extrabold font-mono tracking-widest text-[#ffffff] uppercase">Training Config</h2>
          <p className="text-xs text-dash-muted mt-1 leading-relaxed">Formulate your targeted learning matrix dynamically</p>
        </div>

        {/* Target programming selection */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-dash-muted">Synthesizer language</label>
          <div className="grid grid-cols-3 gap-2">
            {["Python", "JavaScript", "Rust", "Java", "Kotlin", "Deno", "C", "C++", "C#"].map(item => (
              <button
                key={item}
                onClick={() => setLang(item)}
                className={`py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer border ${
                  lang === item 
                    ? "bg-dash-blue border-dash-blue/50 text-white font-black shadow-md" 
                    : "bg-dash-surface border-dash-border text-dash-muted hover:bg-[#1a2128]/50 hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {/* Global Starting Elo Selection */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-dash-muted">Global Starting ELO Baseline</label>
          <div className="grid grid-cols-3 gap-2">
            {[800, 1000, 1200].map(val => (
              <button
                key={val}
                onClick={() => props.onChangeDefaultStartingElo(val)}
                className={`py-2 px-1 rounded-lg text-[10px] font-bold font-mono transition-all cursor-pointer border leading-tight ${
                  props.defaultStartingElo === val 
                    ? "bg-dash-blue border-dash-blue/50 text-white font-black shadow-md" 
                    : "bg-dash-surface border-dash-border text-dash-muted hover:bg-[#1a2128]/50 hover:text-white"
                }`}
              >
                {val === 800 ? "800 (Beginner)" : val === 1000 ? "1000 (Junior)" : "1200 (Intermediate)"}
              </button>
            ))}
          </div>
          <p className="text-[10px] font-mono text-dash-muted leading-relaxed">
            Baseline used when resetting progress or initializing a newly selected programming language.
          </p>
        </div>

        {/* Focus bugs */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-dash-muted">Bug taxonomy Focus</label>
          <div className="grid grid-cols-2 gap-2">
            {["Logic", "Architecture", "Security", "Performance"].map(item => {
              const active = focusedErrs.includes(item);
              return (
                <button
                  key={item}
                  onClick={() => toggleErr(item)}
                  className={`p-3 rounded-lg text-xs font-bold font-mono cursor-pointer border text-left flex items-center gap-2 ${
                    active 
                      ? "bg-dash-blue/10 border-dash-blue text-dash-blue" 
                      : "bg-[#0d1117] border-dash-border text-dash-muted hover:bg-[#1a2128]/50 hover:text-white"
                  }`}
                >
                  <div className={`w-3 h-3 rounded border flex items-center justify-center ${active ? "border-dash-blue bg-dash-blue" : "border-dash-border"}`}>
                    {active && <span className="text-[8px] text-[#0d1117] font-black">✓</span>}
                  </div>
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {/* ELO Matchmaking Explanation Box */}
        <div className="bg-[#1a2128] border border-dash-border rounded-xl p-4 space-y-2">
          <span className="text-[9px] font-mono tracking-wider font-extrabold uppercase text-dash-blue flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-dash-blue" />
            ELO & MATCHMAKING MATHEMATICS
          </span>
          <p className="text-[11px] font-mono text-dash-muted leading-relaxed">
            The synthesizer matches you using an **RPG Stat Sheet** paradigm rather than a flat level window. 
            Your rating updates dynamically upon every swipe:
          </p>
          <ul className="text-[10px] font-mono text-dash-muted list-disc list-inside space-y-1 mt-1 pl-1">
            <li><strong className="text-white">Actual Target ELO:</strong> Matches your rating adjusted by concept modifiers (<span className="text-dash-green">Target ELO = Global ELO × Modifier</span>).</li>
            <li><strong className="text-white">Micro-calibration:</strong> Correct reviews grant <span className="text-dash-green">+0.05 modifier</span>. Gaps incur <span className="text-dash-red">-0.25 modifier</span>.</li>
            <li><strong className="text-white">Introductory Mix-In:</strong> New taxonomies unlock organically at <span className="text-dash-green">&gt; 1.20 Average Modifier</span>.</li>
          </ul>
        </div>

        {/* Danger Zone: Reset Progress block */}
        <div className="border border-dash-red/30 bg-dash-red/5 rounded-xl p-4 space-y-3">
          <div>
            <span className="text-[10px] font-mono tracking-wider font-extrabold text-dash-red/90 flex items-center gap-1.5 uppercase">
              <AlertTriangle className="w-3.5 h-3.5" />
              Danger Zone
            </span>
            <p className="text-[10.5px] font-mono text-dash-muted leading-relaxed mt-1">
              Reset ELO rating, skills matrix modifiers, and question queues for <strong className="text-white">{props.currentLanguage}</strong>.
            </p>
          </div>

          {confirmReset ? (
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <p className="text-[10px] font-mono text-amber-500 font-bold leading-normal">
                ⚠️ This is irreversible! This will permanently delete your swiping trials, SRS schedule, and ELO rating metrics for {props.currentLanguage}. Daily goals progress is preserved.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    props.onResetProgress(props.defaultStartingElo);
                    setConfirmReset(false);
                  }}
                  className="flex-1 py-1.5 bg-dash-red hover:bg-dash-red/95 text-white text-xs font-bold font-mono uppercase tracking-wide rounded-lg cursor-pointer border border-dash-red/50 shadow-md"
                >
                  Yes, Wipe Progress
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 bg-[#1a2128] border border-dash-border hover:bg-[#1a2128]/80 text-white text-xs font-bold font-mono uppercase rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="w-full py-2 bg-dash-red/10 border border-dash-red/30 text-dash-red text-xs font-bold font-mono uppercase tracking-widest rounded-lg hover:bg-dash-red/20 transition-all cursor-pointer"
            >
              Reset {props.currentLanguage} Progress
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => props.onSave(lang, focusedErrs)}
        className="w-full mt-4 py-4 bg-dash-blue hover:bg-dash-blue/90 text-white font-bold font-mono text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-lg shadow-dash-blue/10 border border-dash-blue/50"
      >
        Update SECURED Workspace
      </button>

    </div>
  );
}

// Dialog: Review Modal for current swiped cards
function ReviewModal(props: {
  action: {
  card: Card;
  userGuessedCorrectly: boolean;
  actionType: "left" | "right" | "unsure";
  };
  language: string;
  onClose: () => void;
}) {
  const [tutorReply, setTutorReply] = useState<string | null>(null);
  const [tutorLoading, setTutorLoading] = useState(false);

  const handleAskTutor = async () => {
    try {
      setTutorLoading(true);
      const res = await fetch("/api/ask-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: props.language,
          code: props.action.card.code,
          docstring: props.action.card.docstring,
          is_correct: props.action.card.is_correct,
          explanation: props.action.card.explanation
        })
      });
      const data = await res.json();
      if (data.success) {
        setTutorReply(data.response);
      } else {
        if (data.isRateLimit) {
          setTutorReply(`⚡ **Gemini Quota Active (429)**:\n\nThe tutor is rate-limited on the Free Tier right now. Please wait about **${data.retryAfterSeconds || 60}s** before re-consulting the interactive AI tutor!`);
        } else {
          setTutorReply("AI Tutor is currently occupied. Feel free to re-attempt consultation later.");
        }
      }
    } catch (e) {
      setTutorReply("Unable to contact the tutoring instance.");
    } finally {
      setTutorLoading(false);
    }
  };

  const isUnsure = props.action.actionType === "unsure";
  const { card, userGuessedCorrectly } = props.action;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[#0d1117]/80 backdrop-blur-sm">
      <div className="bg-dash-surface border border-dash-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Banner Alert details */}
        <div className={`p-4 font-mono font-bold text-center text-xs shrink-0 flex justify-between items-center uppercase tracking-wider ${
          isUnsure 
            ? "bg-[#21262d] border-b border-dash-border text-dash-muted" 
            : userGuessedCorrectly 
              ? "bg-dash-green/20 border-b border-dash-green/30 text-dash-green" 
              : "bg-dash-red/20 border-b border-dash-red/30 text-dash-red"
        }`}>
          <span>
            {isUnsure ? "🤷 Not Sure" : userGuessedCorrectly ? "✓ Correct!" : "✗ Incorrect"}
          </span>
          <button onClick={props.onClose} className="text-dash-muted hover:text-white font-bold p-1">&times;</button>
        </div>

        {/* scrollable dialog content */}
        <div className="p-4 space-y-4 overflow-y-auto pr-2 no-swipe">
          
          {/* Metadata badges: Language, Logic Taxonomy, Tags, Problem ELO */}
          <div className="flex flex-wrap gap-1.5 font-mono">
            <span className="text-[10px] font-black tracking-widest uppercase bg-dash-blue-glow border border-dash-blue/30 text-dash-blue px-2 py-0.5 rounded-md shadow-sm shrink-0">
              {props.language}
            </span>
            <span className="text-[10px] font-bold tracking-wider text-dash-muted border border-dash-border bg-dash-surface px-2 py-0.5 rounded-md shrink-0">
              {card.errorType} Taxonomy
            </span>
            <span className="text-[10px] font-bold font-mono text-indigo-400 border border-indigo-400/20 bg-indigo-500/5 px-2 py-0.5 rounded-md shrink-0">
              Problem: {card.baseElo || 800} Elo
            </span>
            {card.tags && card.tags.map(tag => (
              <span key={tag} className="text-[10px] font-semibold tracking-wider text-dash-green border border-dash-green/25 bg-dash-green/5 px-1.5 py-0.5 rounded-md shrink-0 font-mono text-xs">
                #{tag}
              </span>
            ))}
          </div>

          <p className="text-xs font-mono text-dash-text leading-relaxed">
            {isUnsure ? (
              <>You swiped <b className="text-dash-blue">Unsure</b>. The code is actually <b className={card.is_correct ? "text-dash-green" : "text-dash-red"}>{card.is_correct ? "Correct" : "Buggy"}</b>.</>
            ) : (
              <>You swiped <b className="text-dash-blue">{props.action.actionType === "right" ? "Correct" : "Buggy"}</b>. The code is actually <b className={card.is_correct ? "text-dash-green" : "text-dash-red"}>{card.is_correct ? "Correct" : "Buggy"}</b>.</>
            )}
          </p>

          <div className="border border-dash-border rounded-xl overflow-hidden bg-[#0d1117]">
            <div className="p-3 text-left overflow-x-auto text-xs font-mono select-text max-h-[180px]">
              <HighlightedCode code={card.code} language={props.language} />
            </div>
          </div>

          {/* Explanation */}
          <div className="bg-[#0d1117]/80 border border-dash-border p-3.5 rounded-xl space-y-1.5">
            <span className="text-[9px] font-mono uppercase text-dash-blue tracking-wider flex items-center gap-1.5 font-extrabold">
              <Lightbulb className="w-3.5 h-3.5" /> Compiler Analysis
            </span>
            <p className="text-xs text-dash-text font-mono leading-relaxed">{card.explanation}</p>
          </div>

          {/* Ask AI Tutor */}
          <div className="pt-2">
            {!tutorReply && !tutorLoading && (
              <button
                onClick={handleAskTutor}
                className="w-full py-2.5 rounded-xl border border-dash-blue/20 bg-dash-blue/10 text-dash-blue font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-dash-blue/20 transition cursor-pointer"
              >
                ✨ Consult Expert Tutor for steps
              </button>
            )}

            {tutorLoading && (
              <div className="p-4 bg-[#0d1117]/60 border border-dash-border rounded-xl text-center">
                <p className="font-mono text-dash-muted text-[10px] uppercase tracking-wider animate-pulse">✨ Formulating tutor explanations ...</p>
              </div>
            )}

            {tutorReply && (
              <div className="p-4 bg-dash-blue/5 border border-dash-blue/20 rounded-xl space-y-2">
                <span className="text-[9px] font-mono uppercase text-dash-blue font-black tracking-widest flex items-center gap-1">✨ Tutor Output</span>
                <p className="text-xs text-dash-text font-mono leading-relaxed whitespace-pre-wrap">{tutorReply}</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-dash-border bg-[#1c2128]/40 shrink-0">
          <button
            onClick={props.onClose}
            className="w-full py-3 bg-dash-blue hover:bg-dash-blue/90 border border-dash-blue/50 text-white font-bold font-mono text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer"
          >
            Review Confirmed
          </button>
        </div>
      </div>
    </div>
  );
}

// Dialog: Review Modal for previous swiped details in logger
function HistoryReviewModal(props: {
  card: Attempt | Card;
  language: string;
  onClose: () => void;
}) {
  const [tutorReply, setTutorReply] = useState<string | null>(null);
  const [tutorLoading, setTutorLoading] = useState(false);

  const handleAskTutor = async () => {
    try {
      setTutorLoading(true);
      const res = await fetch("/api/ask-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: props.language,
          code: props.card.code,
          docstring: props.card.docstring,
          is_correct: props.card.is_correct,
          explanation: props.card.explanation
        })
      });
      const data = await res.json();
      if (data.success) {
        setTutorReply(data.response);
      } else {
        if (data.isRateLimit) {
          setTutorReply(`⚡ **Gemini Quota Active (429)**:\n\nThe tutor is rate-limited on the Free Tier right now. Please wait about **${data.retryAfterSeconds || 60}s** before re-consulting the interactive AI tutor!`);
        } else {
          setTutorReply("AI Tutor is currently busy. Please retry shortly.");
        }
      }
    } catch (e) {
      setTutorReply("Failed to reach tutoring instance.");
    } finally {
      setTutorLoading(false);
    }
  };

  const isAttempt = "swipedType" in props.card;
  const attempt = isAttempt ? (props.card as Attempt) : null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[#0d1117]/80 backdrop-blur-sm">
      <div className="bg-dash-surface border border-dash-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Banner */}
        <div className="p-4 bg-[#1c2128] border-b border-dash-border flex justify-between items-center text-white">
          <span className="font-mono text-xs font-bold uppercase tracking-wider">Attempt Study Review</span>
          <button onClick={props.onClose} className="text-dash-muted hover:text-white font-bold p-1">&times;</button>
        </div>

        {/* content scroll */}
        <div className="p-4 space-y-4 overflow-y-auto pr-2 no-swipe">
          {attempt && (
            <div className="bg-[#0d1117] p-3 rounded-lg border border-dash-border space-y-1.5 font-mono">
              <div className="flex justify-between items-center text-[10px] text-dash-muted">
                <span className="flex items-center gap-1 uppercase tracking-wider"><Calendar className="w-3 h-3" /> Swiped On</span>
                <span>{new Date(attempt.answeredAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-dash-muted uppercase text-[10px]">Your Answer:</span>
                <span className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${
                  attempt.swipedType === "unsure" 
                    ? "bg-[#21262d] border-dash-border text-dash-text" 
                    : attempt.userGuessedCorrectly 
                      ? "bg-dash-green/10 border-dash-green/20 text-dash-green" 
                      : "bg-dash-red/10 border-dash-red/20 text-dash-red"
                }`}>
                  {attempt.swipedType === "unsure" 
                    ? "UNSURE 🤷" 
                    : attempt.userGuessedCorrectly 
                      ? "CORRECT ✓" 
                      : "INCORRECT ✗"}
                </span>
              </div>
            </div>
          )}

          <div className="p-1 space-y-2">
            <div>
              <h4 className="font-mono text-xs font-black text-white">{props.card.funcName}()</h4>
              <p className="text-[10px] font-mono text-dash-muted mt-1">Goal: "{props.card.docstring}"</p>
            </div>

            {/* Metadata badges: Language, Logic Taxonomy, Tags, Problem ELO */}
            <div className="flex flex-wrap gap-1.5 font-mono pt-1">
              <span className="text-[10px] font-black tracking-widest uppercase bg-dash-blue-glow border border-dash-blue/30 text-dash-blue px-2 py-0.5 rounded-md shadow-sm shrink-0">
                {props.language}
              </span>
              <span className="text-[10px] font-bold tracking-wider text-dash-muted border border-dash-border bg-dash-surface px-2 py-0.5 rounded-md shrink-0">
                {props.card.errorType} Taxonomy
              </span>
              <span className="text-[10px] font-bold font-mono text-indigo-400 border border-indigo-400/20 bg-indigo-500/5 px-2 py-0.5 rounded-md shrink-0">
                Problem: {props.card.baseElo || 800} Elo
              </span>
              {props.card.tags && props.card.tags.map(tag => (
                <span key={tag} className="text-[10px] font-semibold tracking-wider text-dash-green border border-dash-green/25 bg-dash-green/5 px-1.5 py-0.5 rounded-md shrink-0 font-mono text-xs">
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <div className="border border-dash-border rounded-xl Gym overflow-hidden bg-[#0d1117]">
            <div className="p-3 text-left overflow-x-auto text-[11px] font-mono select-text max-h-[180px]">
              <HighlightedCode code={props.card.code} language={props.language} />
            </div>
          </div>

          {/* Explanation */}
          <div className="bg-[#0d1117]/80 border border-dash-border p-3.5 rounded-xl space-y-1">
            <span className="text-[9px] font-mono uppercase text-dash-blue font-extrabold flex items-center gap-1">
              <Lightbulb className="w-3.5 h-3.5" /> Static Analysis
            </span>
            <p className="text-xs text-dash-text font-mono leading-relaxed">{props.card.explanation}</p>
          </div>

          {/* AI Tutor */}
          <div className="pt-2">
            {!tutorReply && !tutorLoading && (
              <button
                onClick={handleAskTutor}
                className="w-full py-2.5 rounded-xl border border-dash-blue/20 bg-dash-blue/10 text-dash-blue font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-dash-blue/20 transition cursor-pointer"
              >
                ✨ Consult Expert Tutor for steps
              </button>
            )}

            {tutorLoading && (
              <div className="p-4 bg-[#0d1117]/60 border border-dash-border rounded-xl text-center font-mono">
                <p className="text-dash-muted text-[10px] uppercase tracking-wider animate-pulse">✨ Contacting AI tutoring agent ...</p>
              </div>
            )}

            {tutorReply && (
              <div className="p-4 bg-dash-blue/5 border border-dash-blue/20 rounded-xl space-y-2">
                <span className="text-[9px] font-mono uppercase text-dash-blue font-black tracking-widest flex items-center gap-1">✨ Tutor Output</span>
                <p className="text-xs text-dash-text font-mono leading-relaxed whitespace-pre-wrap">{tutorReply}</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-dash-border bg-[#1c2128]/40 shrink-0">
          <button
            onClick={props.onClose}
            className="w-full py-3 bg-dash-blue hover:bg-dash-blue/90 border border-dash-blue/50 text-white font-bold font-mono text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer"
          >
            Finished Analyzing
          </button>
        </div>
      </div>
    </div>
  );
}
