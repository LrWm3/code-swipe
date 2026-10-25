// Curated high-quality fallback coding cards for offline study and when Gemini limits are hit.
import { Card } from "./App";

export const OFFLINE_CARDS: Card[] = [
  // --- PYTHON ---
  {
    id: "off_py_logic_1",
    funcName: "calculate_bonus",
    docstring: "Computes employee performance bonuses. Bonuses are 10% of base salary if rating is above 4.5, otherwise 5%. But buggy implementation returns wrong calculation.",
    language: "Python",
    errorType: "Logic",
    code: `def calculate_bonus(salary: float, rating: float) -> float:
    # BUG: Incorrect conditional logic using assignments or misplaced operators
    if rating >= 4.5:
        bonus_pct = 0.10
    else:
        bonus_pct = 0.05
    
    # Bug here: assigning instead of comparison in some logic, or here:
    return salary + (salary * bonus_pct)`,
    is_correct: true,
    explanation: "This implementation correctly calculates the bonus based on rating, adding the percentage multiplier to the base salary."
  },
  {
    id: "off_py_logic_1_bug",
    funcName: "find_average_temperature",
    docstring: "Calculates the mathematical mean of recorded daily temperatures, ignoring None/missing entries.",
    language: "Python",
    errorType: "Logic",
    code: `def find_average_temperature(temps: list) -> float:
    valid_temps = [t for t in temps if t is not None]
    if len(valid_temps) == 0:
        return 0.0
    
    # BUG: Divides sum of list by the original list length instead of filtered list length
    total = sum(valid_temps)
    return total / len(temps)`,
    is_correct: false,
    explanation: "The snippet calculates average by dividing total sum by the original list length, which incorrectly includes None/missing records as count dividers."
  },
  {
    id: "off_py_security_1",
    funcName: "fetch_user_profile",
    docstring: "Executes a query to load user profile attributes safely based on ID criteria.",
    language: "Python",
    errorType: "Security",
    code: `def fetch_user_profile(db_connection, user_id: str):
    cursor = db_connection.cursor()
    # Safe query using parameterized inputs
    cursor.execute("SELECT id, username, email FROM users WHERE id = %s", (user_id,))
    return cursor.fetchone()`,
    is_correct: true,
    explanation: "The SQL execution uses parameterized inputs '%s' with values supplied as arguments, preventing SQL Injection vulnerabilities."
  },
  {
    id: "off_py_security_1_bug",
    funcName: "query_dashboard_data",
    docstring: "Loads system statistics from the database using direct query parsing.",
    language: "Python",
    errorType: "Security",
    code: `def query_dashboard_data(db_cursor, report_type: str, user_role: str):
    # BUG: Direct string formatting into SQL results in a severe SQL Injection vulnerability.
    query = f"SELECT * FROM telemetry WHERE category = '{report_type}' AND visibility = '{user_role}'"
    db_cursor.execute(query)
    return db_cursor.fetchall()`,
    is_correct: false,
    explanation: "Using python string interpolation (f-strings) inside raw SQL queries is highly vulnerable to SQL Injection, as malicious raw payloads can escape parameter controls."
  },
  {
    id: "off_py_performance_1",
    funcName: "check_duplicates",
    docstring: "Checks if a list has any duplicate records by doing structured linear checking.",
    language: "Python",
    errorType: "Performance",
    code: `def check_duplicates(items: list) -> bool:
    seen = set()
    for item in items:
      if item in seen:
        return True
      seen.add(item)
    return False`,
    is_correct: true,
    explanation: "The membership checking is performed against a Set collection, running in average O(1) time complexity."
  },
  {
    id: "off_py_performance_1_bug",
    funcName: "verify_unique_keys",
    docstring: "Reports True if all string values in a data stream array are entirely unique.",
    language: "Python",
    errorType: "Performance",
    code: `def verify_unique_keys(values: list) -> bool:
    # BUG: Inefficient duplicate searching in O(N^2) using item checking on normal array
    processed = []
    for value in values:
        if value in processed:
            return False
        processed.append(value)
    return True`,
    is_correct: false,
    explanation: "Checking membership 'value in processed' runs in O(N) when 'processed' is a list. The total search loop results in a slow quadratic O(N^2) algorithm."
  },

  // --- JAVASCRIPT / TYPESCRIPT ---
  {
    id: "off_js_logic_1",
    funcName: "getUserSettings",
    docstring: "Returns key dashboard preferences, utilizing safe defaults for undefined configurations.",
    language: "JavaScript",
    errorType: "Logic",
    code: `function getUserSettings(prefs) {
  const theme = prefs.theme ?? "dark";
  const autoSave = prefs.autoSave ?? true;
  const timeout = prefs.timeout ?? 3000;
  
  return { theme, autoSave, timeout };
}`,
    is_correct: true,
    explanation: "This correctly uses the nullish coalescing operator (??), preserving falsy values like false or 0 if they are explicitly passed by the user."
  },
  {
    id: "off_js_logic_1_bug",
    funcName: "parseMetricConfigs",
    docstring: "Extracts application telemetry configuration, honoring falsey configurations as explicit selections.",
    language: "JavaScript",
    errorType: "Logic",
    code: `function parseMetricConfigs(config) {
  // BUG: Uses logical OR (||) which overrides false / 0 configs with default values
  const enableTelemetry = config.enableTelemetry || true;
  const retryInterval = config.retryInterval || 1000;
  const name = config.name || "Default Telemetry";
  
  return { enableTelemetry, retryInterval, name };
}`,
    is_correct: false,
    explanation: "Using logical OR (||) for defaults is buggy because if a client passes enableTelemetry as 'false' or retryInterval as '0', it gets overwritten with defaults 'true' and '1000'."
  },
  {
    id: "off_js_security_1",
    funcName: "sanitizeHTMLNode",
    docstring: "Sanitizes raw innerHTML insertions to safely display user profile reviews.",
    language: "JavaScript",
    errorType: "Security",
    code: `function sanitizeHTMLNode(containerEle, rawHtml) {
  // Securely escape html elements to prevent cross-site scripting (XSS)
  const escaped = rawHtml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  containerEle.innerHTML = escaped;
}`,
    is_correct: true,
    explanation: "Escaping special markup characters prevents execution of malicious Javascript lines within raw strings."
  },
  {
    id: "off_js_security_1_bug",
    funcName: "renderReviewContent",
    docstring: "Binds user review text outputs to dashboard viewport components directly.",
    language: "JavaScript",
    errorType: "Security",
    code: `function renderReviewContent(viewport, snippetText) {
  // BUG: Bypasses standard sanitization, allowing arbitrary <script> tag injection (XSS)
  const wrapper = \`<div><h3>Telemetry Review</h3><p>\${snippetText}</p></div>\`;
  viewport.innerHTML = wrapper;
}`,
    is_correct: false,
    explanation: "Direct assignment of variables containing raw user metrics/strings into innerHTML without sanitization allows an attacker to inject script nodes, triggering Cross-Site Scripting (XSS)."
  },

  // --- RUST ---
  {
    id: "off_rust_logic_1",
    funcName: "compute_index",
    docstring: "Searches the vector array for a matching transaction value and returns an Option indicating position index.",
    language: "Rust",
    errorType: "Logic",
    code: `fn compute_index(items: &Vec<u32>, target: u32) -> Option<usize> {
    for (idx, &item) in items.iter().enumerate() {
        if item == target {
            return Some(idx);
        }
    }
    None
}`,
    is_correct: true,
    explanation: "This correctly iterates over the references in the vector, enumerates indices, and returns the wrapping Option structure."
  },
  {
    id: "off_rust_logic_1_bug",
    funcName: "extract_first_element",
    docstring: "Attempts to pop or extract the first logical element securely from a generic elements vector.",
    language: "Rust",
    errorType: "Logic",
    code: `fn extract_first_element(items: &mut Vec<String>) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    // BUG: Rust vector remove(index) shifts left, but this deletes from the end due to using len() - 1
    let match_index = items.len() - 1;
    Some(items.remove(match_index))
}`,
    is_correct: false,
    explanation: "The docstring describes returning the FIRST element, but the logic computes index 'items.len() - 1' which returns the LAST element instead."
  },

  // --- C++ ---
  {
    id: "off_cpp_performance_1",
    funcName: "processLogs",
    docstring: "Loops through logged memory errors using const reference iteration to avoid excessive memory replication.",
    language: "C++",
    errorType: "Performance",
    code: `#include <vector>
#include <string>

void processLogs(const std::vector<std::string>& logs) {
    for (const auto& log : logs) {
        if (!log.empty()) {
            // Processing logic using reference const auto
        }
    }
}`,
    is_correct: true,
    explanation: "The loop uses 'const auto& log' to bind a read-only reference of each string, avoiding copying overheads on large datasets."
  },
  {
    id: "off_cpp_performance_1_bug",
    funcName: "aggregateMetricPayload",
    docstring: "Iterates large diagnostic log structures to parse aggregated summary telemetry streams.",
    language: "C++",
    errorType: "Performance",
    code: `#include <vector>
#include <string>

void aggregateMetricPayload(std::vector<std::string> rawMetrics) {
    // BUG: Iterating by value triggers copy constructors for every item in vector
    for (auto metric : rawMetrics) {
        if (metric.length() > 0) {
            // Accumulate analytics metric
        }
    }
}`,
    is_correct: false,
    explanation: "The loop iterates using 'auto metric : rawMetrics' by value instead of const reference. This forces C++ to duplicate each string on iteration, which is incredibly slow for large lists."
  }
];

export function getOfflineCards(language: string, errorTypes: string[]): Card[] {
  const target = (language || "").toLowerCase();
  
  // Filter cards matching the language and errorTypes list
  const filtered = OFFLINE_CARDS.filter(
    (c) => c && c.language && c.language.toLowerCase() === target && errorTypes.includes(c.errorType)
  );
  if (filtered.length > 0) {
    return filtered;
  }
  // Try filtering just by language
  const langFiltered = OFFLINE_CARDS.filter((c) => c && c.language && c.language.toLowerCase() === target);
  if (langFiltered.length > 0) {
    return langFiltered;
  }
  // Strictly filter by language for the default pool rather than returning all languages
  return OFFLINE_CARDS.filter((c) => c && c.language && c.language.toLowerCase() === target);
}
