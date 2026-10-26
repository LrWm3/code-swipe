import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, Code2, Download, Flag, FlaskConical, HelpCircle, LoaderCircle, Settings2, ShieldCheck, Sparkles, Terminal, X } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import type { Answer, AppState, Discussion, Hypothesis, Job, LessonFeedback, LessonSummary, Metrics, ProviderId, Review, ReviewSession, Settings } from './types';
import { flushReviewSessions, useAnswerClock, useReviewSync, useReviewTiming } from './ui';

hljs.registerLanguage('javascript', javascript);
const PROVIDER_NAMES: Record<ProviderId, string> = { codex: 'Codex', opencode: 'OpenCode', demo: 'Practice demo' };
const defaults: Settings = { provider: 'demo', model: '', interests: '', batchSize: 4, tutorMode: 'reflective' };
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const json = (value: unknown) => JSON.stringify(value, null, 2);
const answerLabel = (answer: Answer) => answer === 'idk' ? 'IDK' : answer === 'correct' ? 'Correct' : 'Buggy';
const resultLabel = (correct: boolean | null) => correct === null ? 'IDK · ungraded' : correct ? 'Correct answer' : 'Incorrect answer';
const quickResultLabel = (correct: boolean | null) => correct === null ? 'IDK · ungraded' : correct ? 'Correct!' : 'Incorrect';
const resultTone = (correct: boolean | null) => correct === null ? 'neutral' : correct ? 'positive' : 'negative';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';

async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(path, {
      method,
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data as T;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new Error('Cannot reach your local server. Keep it running, then reconnect.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function Code({ code }: { code: string }) {
  const highlighted = useMemo(() => hljs.highlight(code, { language: 'javascript' }).value, [code]);
  return <pre className="code-block" tabIndex={0} aria-label="JavaScript source"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>;
}

function Badge({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function PreviousAnswer({ review, disabled, onReview }: { review: Review; disabled: boolean; onReview: () => void }) {
  return <div className="previous-answer" data-testid="previous-answer" aria-label="Previous answer">
    <span className={`answer-result ${resultTone(review.attempt.correct)}`}>
      {review.attempt.correct === null ? <HelpCircle size={18} /> : review.attempt.correct ? <CheckCircle2 size={18} /> : <X size={18} />}
      {quickResultLabel(review.attempt.correct)}
    </span>
    <button className="button compact quiet" onClick={onReview} disabled={disabled} data-testid="review-previous">Review previous<ChevronRight size={15} /></button>
  </div>;
}

function Accountability({ metrics, settings }: { metrics: Metrics; settings: Settings }) {
  return <section className="panel accountability">
    <div className="eyebrow"><ShieldCheck size={15} /> Tutor accountability</div>
    <h2>How well does it predict?</h2><p className="fine-print">{PROVIDER_NAMES[settings.provider]} · {settings.tutorMode} mode</p>
    <p className="muted">These measure the tutor’s predictions of your answers, not learning or mastery.</p>
    <div className="metric-grid">
      <div><strong data-testid="brier-score">{metrics.brier === null ? '—' : metrics.brier.toFixed(3)}</strong><span>Brier score</span></div>
      <div><strong>{metrics.count}</strong><span>Scored answers</span></div>
    </div>
    <p className="fine-print">Lower Brier is better. 0 is perfect; always predicting 50% scores 0.25. Flagged and IDK answers are excluded.</p>
    <details className="plain-details">
      <summary>Prediction calibration</summary>
      <p className="fine-print">Compare predicted success with observed correct answers. Small samples are noisy.</p>
      <div className="table-scroll"><table className="calibration-table"><thead><tr><th>Range</th><th>Predicted</th><th>Actual</th><th>n</th></tr></thead><tbody>
        {metrics.calibration.map((bin) => <tr key={bin.label}><td>{bin.label}</td><td>{percent(bin.predicted)}</td><td>{percent(bin.actual)}</td><td>{bin.count}</td></tr>)}
      </tbody></table></div>
      {metrics.byPurpose.filter((item) => item.count > 0).length > 0 && <div className="purpose-stats">{metrics.byPurpose.filter((item) => item.count > 0).map((item) => <div key={item.purpose}><span>{item.purpose}</span><span>{percent(item.accuracy)} correct · {item.count} answers</span></div>)}</div>}
    </details>
    {settings.provider === 'demo' && <p className="fine-print demo-note"><FlaskConical size={14} /> Demo predictions are scripted. These results include only demo answers in this mode.</p>}
  </section>;
}

function ReviewPanel({ review, pending, onFlag }: { review: Review; pending: boolean; onFlag: (review: Review) => void }) {
  const { question, attempt } = review;
  const checks = question.tests.map((test, index) => ({
    test,
    index,
    failure: question.validation.failures.find((item) => JSON.stringify(item.input) === JSON.stringify(test.input)),
  }));
  const failures = checks.filter((check) => check.failure);
  const passing = checks.filter((check) => !check.failure);
  const renderCheck = ({ test, index, failure }: typeof checks[number]) => (
    <div className={`test-case ${failure ? 'failed' : ''}`} key={index}>
      <div className="test-heading"><span>{failure ? <X size={15} /> : <Check size={15} />} Check {index + 1}{failure ? ' · counterexample' : ' · passed'}</span>{test.note && <small>{test.note}</small>}</div>
      <dl><div><dt>Input</dt><dd><code>{json(test.input)}</code></dd></div><div><dt>Expected</dt><dd><code>{json(test.expected)}</code></dd></div><div><dt>Actual</dt><dd><code>{failure ? (failure.error || json(failure.actual)) : json(test.expected)}</code></dd></div></dl>
    </div>
  );
  return <div className="review-content" data-testid="answer-review">
    <div className={`result-banner ${attempt.correct === null ? 'neutral' : attempt.correct ? 'positive' : 'negative'}`} role="status">
      {attempt.correct === null ? <HelpCircle size={23} /> : attempt.correct ? <CheckCircle2 size={23} /> : <X size={23} />}
      <div><strong>{resultLabel(attempt.correct)}</strong><span>You chose {answerLabel(attempt.answer)}. This code is <b>{question.verdict}</b>.</span></div>
      <Badge>{(attempt.elapsedMs / 1000).toFixed(1)}s</Badge>
    </div>
    <div className="review-section"><h3>Why {question.verdict}?</h3><p>{question.explanation}</p></div>
    <div className="review-section"><h3>Test evidence</h3><p className="fine-print">{question.validation.passedCount} of {question.validation.testCount} checks passed for this implementation. Tests support this verdict; they do not prove correctness for every possible input.</p>
      {failures.length > 0 && <div className="test-list">{failures.map(renderCheck)}</div>}
      {passing.length > 0 && <details className="plain-details passing-checks" data-testid="passing-checks">
        <summary>Inspect {passing.length} passing {passing.length === 1 ? 'check' : 'checks'}</summary>
        <div className="test-list">{passing.map(renderCheck)}</div>
      </details>}
    </div>
    <details className="plain-details code-details"><summary>Revisit this code and specification</summary><p>{question.specification}</p><Code code={question.code} /></details>
    <details className="plain-details code-details"><summary>Reference implementation</summary><Code code={question.referenceCode} /></details>
    <div className="prediction-box">
      <div className="eyebrow"><ShieldCheck size={15} /> Committed before your answer</div>
      <h3>{percent(question.prediction.pCorrect)} predicted chance you would answer correctly</h3>
      <p>{question.prediction.rationale}</p>
      <p className="fine-print">pCorrect = {question.prediction.pCorrect.toFixed(2)} · {question.purpose} probe{question.hypothesisId ? ` · ${question.hypothesisId}` : ''}</p>
      <details className="plain-details"><summary>Tutor’s prewritten interpretation</summary><p>{attempt.correct === null ? "You chose IDK. This answer is ungraded; neither prewritten verdict interpretation applies." : attempt.correct ? question.ifCorrect : question.ifIncorrect}</p></details>
    </div>
    <div className="flag-row"><div><strong>Question seems flawed?</strong><p className="fine-print">Flagging keeps this answer in your notebook and excludes it from scoring and tutor evidence.</p></div><button className={`button compact ${attempt.flagged ? 'flagged' : 'quiet'}`} onClick={() => onFlag(review)} disabled={pending} aria-pressed={attempt.flagged} data-testid="flag-attempt"><Flag size={15} />{attempt.flagged ? 'Excluded · undo' : 'Flag item'}</button></div>
  </div>;
}

function HypothesisCard({ hypothesis, reviews }: { hypothesis: Hypothesis; reviews: Review[] }) {
  const evidence = (ids: string[]) => ids.map((id) => {
    const review = reviews.find((item) => item.attempt.id === id);
    return <li key={id}>{review ? <>{review.question.title} — {resultLabel(review.attempt.correct)}{review.attempt.flagged ? ' (flagged; excluded)' : ''}</> : <code>{id}</code>}</li>;
  });
  return <div className="hypothesis-card"><div className="section-heading"><h4>{hypothesis.claim}</h4><Badge tone={hypothesis.status === 'supported' ? 'green' : ''}>{hypothesis.status}</Badge></div>
    {hypothesis.supportingAttemptIds.length > 0 && <div><span className="small-label">Supporting evidence</span><ul>{evidence(hypothesis.supportingAttemptIds)}</ul></div>}
    {hypothesis.counterevidenceAttemptIds.length > 0 && <div><span className="small-label">Counterevidence</span><ul>{evidence(hypothesis.counterevidenceAttemptIds)}</ul></div>}
    {hypothesis.alternatives.length > 0 && <div><span className="small-label">Other explanations</span><ul>{hypothesis.alternatives.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <p><span className="small-label">Next probe</span>{hypothesis.nextProbe}</p>
  </div>;
}

function Notebook({ state, selectedId, onSelect, onReview, onPractice }: { state: AppState; selectedId: string | null; onSelect: (id: string) => void; onReview: (id: string) => void; onPractice: () => void }) {
  const ordered = [...state.lessons].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const selected = ordered.find((lesson) => lesson.id === selectedId) || ordered[0];
  const reviews = selected ? state.reviews.filter((review) => review.attempt.lessonId === selected.id).sort((a, b) => Date.parse(a.attempt.answeredAt) - Date.parse(b.attempt.answeredAt)) : [];
  return <div className="notebook-view"><div className="page-intro"><div><div className="eyebrow">Your local record</div><h1>Tutor notebook</h1><p className="muted">Lessons, answers, feedback, and the tutor’s reasoning.</p></div><a className="button quiet" href="/api/export" download><Download size={17} /> Export record</a></div>
    <details className="notebook-metrics"><summary>Tutor prediction metrics</summary><Accountability metrics={state.metrics} settings={state.settings} /></details>
    {ordered.length === 0 ? <div className="panel empty-state"><BookOpen size={36} /><h2>A fresh notebook.</h2><p>Your first lesson will appear here.</p></div> : <div className="notebook-grid"><div className="lesson-list" aria-label="Lessons">{ordered.map((lesson, index) => <button key={lesson.id} onClick={() => onSelect(lesson.id)} className={`lesson-list-item ${selected?.id === lesson.id ? 'selected' : ''}`} aria-pressed={selected?.id === lesson.id}><span className="small-label">Lesson {ordered.length - index} · {PROVIDER_NAMES[lesson.provider]}</span><strong>{lesson.objective}</strong><span>{date(lesson.createdAt)}</span><span className="lesson-list-status">{lesson.answered}/{lesson.total} answers <Badge tone={lesson.complete ? 'green' : ''}>{lesson.complete ? 'Complete' : 'In progress'}</Badge></span></button>)}</div>
      {selected && <section className="panel notebook-detail"><div className="eyebrow">{PROVIDER_NAMES[selected.provider]} · {selected.tutorMode}</div><h2>{selected.objective}</h2><p>{selected.rationale}</p>
        {selected.complete ? <><div className="notebook-section"><h3>Reflection before this lesson</h3><p className="preserve-lines">{selected.reflection || 'No prior reflection recorded.'}</p></div><div className="notebook-section"><h3>Starting assumptions</h3>{selected.assumptions.length ? <ul>{selected.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">No assumptions recorded.</p>}</div><div className="notebook-section"><h3>Working hypotheses</h3><p className="fine-print">These are tentative explanations, not fixed labels about you.</p>{selected.hypotheses.length ? selected.hypotheses.map((hypothesis) => <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} reviews={state.reviews} />) : <p className="muted">No hypotheses recorded for this lesson.</p>}</div></> : <div className="notice">Finish this lesson to reveal its assumptions, reflection, and hypotheses.</div>}
        {selected.feedback && <div className="notebook-section" data-testid="saved-lesson-feedback"><h3>Your lesson feedback</h3><p className="preserve-lines">{selected.feedback.text || 'No written feedback.'}</p><p className="fine-print">{selected.feedback.accidentalAttemptIds.length} accidental answers excluded · {date(selected.feedback.updatedAt)}</p></div>}
        {state.discussions.filter(item => item.lessonId === selected.id).map(item => <div className="notebook-section" key={item.id}><h3>Tutor conversation · {date(item.createdAt)}</h3>{item.feedbackText && <details className="plain-details"><summary>Feedback shared</summary><p className="preserve-lines">{item.feedbackText}</p></details>}<p className="preserve-lines">{item.reflection}</p>{item.questions.map(question => <div className="conversation-reply" key={question.id}><h4>{question.text}</h4><p className="preserve-lines">{question.answer ?? (question.skipped ? 'Skipped' : 'No reply yet')}</p></div>)}</div>)}
        <div className="notebook-section"><h3>Answers & committed predictions</h3>{reviews.length === 0 && <p className="muted">No answers yet.</p>}{reviews.map((review) => {
          const sessions = (state.reviewSessions || []).filter((session) => session.attemptId === review.attempt.id);
          return <button className="answer-history answer-history-button" key={review.attempt.id} onClick={() => onReview(review.attempt.id)} data-testid="notebook-review" data-attempt-id={review.attempt.id}><span className={`answer-dot ${review.attempt.correct === null ? 'neutral' : review.attempt.correct ? 'green' : 'red'}`} /><span>{review.question.title}<small>{answerLabel(review.attempt.answer)} · {resultLabel(review.attempt.correct)} · {percent(review.question.prediction.pCorrect)} predicted{review.attempt.flagged ? ` · ${review.attempt.exclusionReason === 'accidental-input' ? 'accidental input' : 'flagged'}; excluded` : ''}</small><small>{sessions.length ? `${sessions.length} review ${sessions.length === 1 ? 'opening' : 'openings'} · ${(sessions.reduce((total, session) => total + session.activeMs, 0) / 1000).toFixed(1)}s active` : 'No recorded review'}</small></span><ChevronRight size={16} /></button>;
        })}</div>
        <details className="plain-details"><summary>Prediction commitment</summary><p className="fine-print">Predictions were saved before the lesson’s first answer.</p><code className="hash">{selected.predictionHash}</code></details><div className="review-footer"><button className="button primary" onClick={onPractice}>{state.question ? 'Resume lesson' : 'Back to practice'}<ArrowRight size={17} /></button></div>
      </section>}</div>}
  </div>;
}

function ReviewDialog({ review, pending, error, onFlag, onClose }: { review: Review; pending: boolean; error: string; onFlag: (review: Review) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useReviewTiming(review.attempt.id);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="review-title" data-testid="review-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="review-dialog-inner"><header className="review-dialog-header"><div><span className="eyebrow">Answer review</span><h2 id="review-title">{review.question.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close review" data-testid="close-review"><X size={22} /></button></header><div className="review-dialog-body">{error && <div className="notice error" role="alert">{error}</div>}<ReviewPanel review={review} pending={pending} onFlag={onFlag} /></div><footer className="review-dialog-footer"><button className="button primary" onClick={onClose} data-testid="back-to-practice">Done reviewing<ArrowRight size={16} /></button></footer></div>
  </dialog>;
}

type ReplyDraft = { discussionId: string; replies: { questionId: string; answer: string }[] };
type FeedbackDraft = Pick<LessonFeedback, 'text' | 'accidentalAttemptIds'> & { followUp?: ReplyDraft };
function readReplyDraft(discussion?: Discussion): ReplyDraft | undefined {
  if (!discussion) return;
  let saved: ReplyDraft | undefined;
  try { saved = JSON.parse(localStorage.getItem(`code-swipe-replies:${discussion.id}`) || 'null'); } catch { /* Use server replies. */ }
  return { discussionId: discussion.id, replies: discussion.questions.map(question => {
    const draft = Array.isArray(saved?.replies) ? saved.replies.find(item => item?.questionId === question.id)?.answer : undefined;
    return { questionId: question.id, answer: typeof draft === 'string' ? draft.slice(0, 4000) : question.answer || '' };
  }) };
}
function readFeedbackDraft(lesson: LessonSummary, reviews: Review[]): FeedbackDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(`code-swipe-feedback:${lesson.id}`) || 'null');
    if (typeof saved?.text === 'string' && Array.isArray(saved.accidentalAttemptIds)) return { text: saved.text.slice(0, 4000), accidentalAttemptIds: saved.accidentalAttemptIds.filter((id: unknown) => typeof id === 'string' && reviews.some((review) => review.attempt.id === id)) };
  } catch { /* Server feedback remains the default when browser storage is unavailable. */ }
  return { text: lesson.feedback?.text || '', accidentalAttemptIds: lesson.feedback?.accidentalAttemptIds || reviews.filter((item) => item.attempt.exclusionReason === 'accidental-input').map((item) => item.attempt.id) };
}
function LessonComplete({ lesson, reviews, discussion, job, pending, canPlan, reflective, onSave, onDiscuss, onCancel, onNext, onNotebook }: {
  lesson: LessonSummary; reviews: Review[]; discussion?: Discussion; job: Job | null; pending: string; canPlan: boolean; reflective: boolean;
  onSave: (draft: FeedbackDraft) => void; onDiscuss: (draft: FeedbackDraft) => void; onCancel: () => void; onNext: (draft: FeedbackDraft) => void; onNotebook: () => void;
}) {
  const [initial] = useState(() => readFeedbackDraft(lesson, reviews));
  const [text, setText] = useState(initial.text);
  const [accidentalAttemptIds, setAccidentalAttemptIds] = useState(initial.accidentalAttemptIds);
  const [replyDraft, setReplyDraft] = useState(() => readReplyDraft(discussion));
  useEffect(() => { setReplyDraft(readReplyDraft(discussion)); }, [discussion?.id]);
  useEffect(() => {
    if (!replyDraft) return;
    try { localStorage.setItem(`code-swipe-replies:${replyDraft.discussionId}`, JSON.stringify(replyDraft)); } catch { /* Keep the visible draft. */ }
  }, [replyDraft]);
  useEffect(() => {
    try { localStorage.setItem(`code-swipe-feedback:${lesson.id}`, JSON.stringify({ text, accidentalAttemptIds })); } catch { /* The visible draft can still be saved through the server. */ }
  }, [lesson.id, text, accidentalAttemptIds]);
  const followUp = replyDraft?.discussionId === discussion?.id ? replyDraft : readReplyDraft(discussion);
  const draft = { text, accidentalAttemptIds, followUp };
  const discussing = job?.kind === 'discussion' && job.status === 'running';
  const disabled = Boolean(pending) || discussing;
  const repliesChanged = discussion?.questions.some(question => {
    const answer = followUp?.replies.find(item => item.questionId === question.id)?.answer.trim() || '';
    return answer !== (question.answer || '') || (!answer && !question.skipped);
  });
  const changed = text !== (lesson.feedback?.text || '') || [...accidentalAttemptIds].sort().join() !== [...(lesson.feedback?.accidentalAttemptIds || [])].sort().join();
  return <section className="panel lesson-complete" data-testid="lesson-complete"><div className="completion-heading"><CheckCircle2 size={24} /><div><h1>Lesson complete</h1><p className="muted">{lesson.total} cards saved.</p></div></div>
    <label htmlFor="lesson-feedback">Anything your tutor should know? <span className="label-note">Optional</span></label>
    <p className="feedback-help fine-print">Share anything: how you reasoned, what confused you, corrections, pacing, or what you want next. Your tutor can reconsider its assumptions using your feedback.</p>
    <textarea id="lesson-feedback" data-testid="lesson-feedback" rows={3} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} placeholder="For example: I understood the loop, but guessed because the input shape was unclear. I'd like more networking examples." disabled={disabled} />
    <details className="plain-details accidental-details"><summary>Mark accidental answers</summary><p className="fine-print">Exclude a misclick or unintended swipe from scoring and tutor evidence. Your original answer stays in your notebook.</p><div className="accidental-answers">{reviews.map((review) => <label key={review.attempt.id}><input type="checkbox" data-testid="accidental-answer" value={review.attempt.id} checked={accidentalAttemptIds.includes(review.attempt.id)} disabled={disabled} onChange={(event) => setAccidentalAttemptIds((ids) => event.target.checked ? [...ids, review.attempt.id] : ids.filter((id) => id !== review.attempt.id))} /><span>{review.question.title}<small>Chose {answerLabel(review.attempt.answer)}</small></span></label>)}</div></details>
    <div className="feedback-save"><span className="fine-print" role="status">{pending === 'feedback' ? 'Saving feedback…' : changed ? 'Saved before your next lesson.' : lesson.feedback ? 'Feedback saved.' : 'Feedback is optional.'}</span><button className="button compact quiet" onClick={() => onSave(draft)} disabled={disabled || !changed} data-testid="save-feedback">Save feedback</button></div>
    {reflective ? <div className="tutor-feedback-actions"><button className="button quiet" onClick={() => onDiscuss(draft)} disabled={disabled || !canPlan} data-testid="discuss-feedback"><Sparkles size={17} />{discussion ? 'Update tutor' : 'Send to tutor'}</button><p className="fine-print">Get a response and optional follow-up questions, or go straight to the next lesson.</p></div> : <p className="fine-print feedback-help">Baseline mode saves your notes but does not use learner history. Choose reflective mode in Setup for tutor conversations.</p>}
    {discussing && <div className="notice discussion-progress" role="status"><LoaderCircle className="spin" size={18} /><div><strong>Your tutor is thinking…</strong><p>You can continue without waiting.</p></div><button className="button compact quiet" onClick={onCancel} disabled={Boolean(pending)}>Cancel</button></div>}
    {discussion && <section className="tutor-discussion" data-testid="tutor-discussion"><h2>Tutor’s take</h2><p className="preserve-lines">{discussion.reflection}</p>
      {discussion.questions.length > 0 ? <><h3>Optional follow-up</h3><p className="fine-print">Answer any you want. Blank replies are skipped, with no penalty. Replies are saved before your next lesson.</p>
        {discussion.questions.map(question => <div className="follow-up-question" key={question.id}><label htmlFor={`reply-${question.id}`}>{question.text}{' '}<span className="label-note">Optional</span></label><textarea id={`reply-${question.id}`} data-testid="follow-up-answer" rows={2} maxLength={4000} disabled={disabled} value={followUp?.replies.find(item => item.questionId === question.id)?.answer || ''} placeholder={question.skipped ? 'Skipped — you can still answer if you want.' : 'Reply, or leave blank to skip.'} onChange={event => setReplyDraft({ discussionId: discussion.id, replies: (followUp?.replies || []).map(item => item.questionId === question.id ? { ...item, answer: event.target.value } : item) })} /></div>)}
        <button className="button compact quiet" disabled={disabled || !repliesChanged} onClick={() => onSave(draft)} data-testid="save-replies">{repliesChanged ? 'Save replies / skip blanks' : 'Replies saved'}</button>
      </> : <p className="fine-print">No follow-up needed. You can add more feedback or continue.</p>}
    </section>}
    <div className="completion-actions"><button className="button primary" onClick={() => onNext(draft)} disabled={Boolean(pending) || !canPlan} data-testid="start-lesson">{pending === 'start' ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{discussing ? 'Skip follow-up & next lesson' : 'Next lesson'}</button><button className="button quiet" onClick={onNotebook} disabled={Boolean(pending)}>Open notebook</button></div>
  </section>;
}

function SettingsPanel({ state, settings, setSettings, onSave, pending }: { state: AppState; settings: Settings; setSettings: (settings: Settings) => void; onSave: () => void; pending: boolean }) {
  const selected = state.providers.find((provider) => provider.id === settings.provider);
  const dirty = JSON.stringify(settings) !== JSON.stringify(state.settings);
  return <div className="settings-view"><div className="page-intro"><div><div className="eyebrow">Make it yours</div><h1>Your tutor setup</h1><p className="muted">Choose one local agent, tell it what interests you, and take a small lesson.</p></div></div><div className="settings-grid"><form className="panel settings-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <label htmlFor="provider">Tutor provider</label><select id="provider" data-testid="provider-select" value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value as ProviderId })}><option value="codex">Codex</option><option value="opencode">OpenCode</option><option value="demo">Practice demo · no agent needed</option></select>
    <div className="provider-status" role="status"><span className={`status-dot ${selected?.available ? '' : 'offline'}`} /><div><strong>{settings.provider === 'demo' ? 'Ready to try' : selected?.available ? 'Installed · login separately' : 'Not detected'}</strong><p>{selected?.detail || 'Provider information unavailable.'}</p>{selected?.version && <code>{selected.version}</code>}</div></div>
    {settings.provider !== 'demo' && <><label htmlFor="model">Model <span className="label-note">optional</span></label><input id="model" value={settings.model} placeholder="Use the agent’s default model" onChange={(event) => setSettings({ ...settings, model: event.target.value })} /><p className="field-help">Use a model name your selected agent supports. Authenticate in its CLI before starting a lesson.</p></>}
    <label htmlFor="interests">What would you like to get better at?</label><textarea id="interests" data-testid="interests-input" rows={4} value={settings.interests} onChange={(event) => setSettings({ ...settings, interests: event.target.value })} placeholder="For example: JavaScript array logic, edge cases in data pipelines, and code I might see in interviews." /><p className="field-help">Plain language is enough. Lessons use small, executable JavaScript functions.</p>
    <fieldset><legend>Cards per lesson</legend><div className="segmented">{[4, 6, 8].map((size) => <button key={size} type="button" className={settings.batchSize === size ? 'selected' : ''} onClick={() => setSettings({ ...settings, batchSize: size })} aria-pressed={settings.batchSize === size}>{size} cards</button>)}</div></fieldset>
    <details className="plain-details"><summary>Experimental comparison</summary><label htmlFor="tutor-mode">Tutor mode</label><select id="tutor-mode" value={settings.tutorMode} onChange={(event) => setSettings({ ...settings, tutorMode: event.target.value as Settings['tutorMode'] })}><option value="reflective">Reflective tutor</option><option value="baseline">Baseline · experimental</option></select><p className="field-help">Reflective mode asks the tutor to revisit its hypotheses using prior answers. Baseline offers a comparison without that reflection. Neither is evidence of improved learning.</p></details>
    <div className="form-footer"><span className="fine-print">{dirty ? 'Unsaved changes' : 'Settings saved locally'}</span><button className="button primary" type="submit" disabled={pending || !dirty} data-testid="save-settings">{pending ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />} Save settings</button></div>
    {state.currentLesson && !state.currentLesson.complete && <p className="fine-print">Changes apply to your next lesson. Your current lesson stays saved.</p>}
  </form><aside className="settings-aside"><section className="panel"><div className="eyebrow"><Terminal size={15} /> One agent. One lesson.</div><h2>Small batches, thoughtful follow-up.</h2><p>The tutor reads your past answers, makes a plan, and commits its predictions before you see a card.</p><p>After each answer, inspect the explanation and executable test evidence. The next lesson can revisit ideas in a different context.</p><p className="fine-print">Practice demo uses fixed exercises and scripted predictions. It is a quick way to try the flow.</p></section><section className="panel"><div className="eyebrow"><ShieldCheck size={15} /> Saved on this computer</div><h2>Your notebook travels with you.</h2><p>Lessons and answers are stored by your local server. Export a copy for your own records.</p><a href="/api/export" download className="button quiet"><Download size={17} /> Export record</a><details className="plain-details"><summary>Backup location</summary><p className="fine-print">Back up this directory to preserve your local record.</p><code className="data-path">{state.dataDirectory}</code></details></section></aside></div></div>;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [view, setView] = useState<'practice' | 'notebook' | 'settings'>('practice');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [lastReviewId, setLastReviewId] = useState<string | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<{ id: string; correct: boolean | null } | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  const uncertainAnswer = useRef<string | null>(null);
  const pointer = useRef<{ x: number; y: number; id: number; horizontal: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const review = state?.reviews.find((item) => item.attempt.id === reviewId) || null;
  const lastReview = state?.reviews.find((item) => item.attempt.id === lastReviewId) || state?.reviews[0] || null;
  const running = state?.job?.status === 'running';
  const discussing = running && state?.job?.kind === 'discussion';
  const chosenProvider = state?.providers.find((provider) => provider.id === state.settings.provider);
  const readAnswerTime = useAnswerClock(state?.question?.id, view === 'practice' && !review && !pending);

  const acceptState = useCallback((next: AppState) => {
    if (!mounted.current) return;
    setState(next);
    setConnectionError('');
    if (uncertainAnswer.current) {
      const saved = next.reviews.find((item) => item.question.id === uncertainAnswer.current);
      if (saved) {
        setLastReviewId(saved.attempt.id);
        setAnswerFeedback({ id: saved.attempt.id, correct: saved.attempt.correct });
        uncertainAnswer.current = null;
        setError('');
      }
    }
  }, []);
  const onReviewSaved = useCallback((session: ReviewSession) => {
    if (!mounted.current) return;
    setState((previous) => {
      if (!previous) return previous;
      const saved = previous.reviewSessions.find((item) => item.id === session.id);
      const merged = saved ? { ...session, activeMs: Math.max(saved.activeMs, session.activeMs), closed: saved.closed || session.closed } : session;
      return { ...previous, reviewSessions: [...previous.reviewSessions.filter((item) => item.id !== session.id), merged] };
    });
  }, []);
  useReviewSync(onReviewSaved, state?.dataDirectory);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = revision.current;
    try {
      const next = await api<AppState>('/api/state', 'GET', undefined, signal);
      if (version === revision.current && !signal?.aborted) acceptState(next);
      return next;
    } catch (failure) {
      if (mounted.current && !signal?.aborted && version === revision.current) setConnectionError(errorMessage(failure));
      return null;
    }
  }, [acceptState]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [refresh]);
  useEffect(() => {
    if (state) setSettings(state.settings);
  }, [state?.settings.provider, state?.settings.model, state?.settings.interests, state?.settings.batchSize, state?.settings.tutorMode]);
  useEffect(() => {
    if (!running && !connectionError) return;
    const controller = new AbortController();
    let timer = 0;
    const tick = async () => {
      if (!busy.current) await refresh(controller.signal);
      if (!controller.signal.aborted) timer = window.setTimeout(tick, connectionError ? 4000 : 1800);
    };
    timer = window.setTimeout(tick, connectionError ? 4000 : 1200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [running, connectionError, refresh]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => { pointer.current = null; setDrag(0); setDragging(false); }, [state?.question?.id, view, reviewId]);
  useEffect(() => {
    if (!answerFeedback) return;
    const timer = window.setTimeout(() => setAnswerFeedback(null), 1700);
    return () => window.clearTimeout(timer);
  }, [answerFeedback?.id]);
  useEffect(() => { setAnswerFeedback(null); }, [view, reviewId]);
  useEffect(() => { if (!reviewId) heading.current?.focus({ preventScroll: true }); }, [state?.question?.id, view]);

  const mutate = useCallback(async (name: string, operation: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    revision.current += 1;
    setPending(name);
    setError('');
    try { await operation(); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); await refresh(); }
    finally { busy.current = false; revision.current += 1; if (mounted.current) setPending(''); }
  }, [refresh]);

  const saveFeedback = async (lessonId: string, draft: FeedbackDraft) => {
    const next = await api<AppState>(`/api/lessons/${encodeURIComponent(lessonId)}/feedback`, 'POST', { text: draft.text, accidentalAttemptIds: draft.accidentalAttemptIds });
    acceptState(next);
  };
  const saveCompletion = async (draft: FeedbackDraft) => {
    if (!state?.currentLesson?.complete) return;
    const existing = state.currentLesson.feedback;
    if (draft.text !== (existing?.text || '') || [...draft.accidentalAttemptIds].sort().join() !== [...(existing?.accidentalAttemptIds || [])].sort().join()) await saveFeedback(state.currentLesson.id, draft);
    if (draft.followUp) acceptState(await api<AppState>(`/api/discussions/${encodeURIComponent(draft.followUp.discussionId)}/replies`, 'POST', { replies: draft.followUp.replies }));
  };
  const discussFeedback = (draft: FeedbackDraft) => mutate('discuss', async () => {
    if (!state?.currentLesson) return;
    await saveCompletion(draft);
    if (!(await flushReviewSessions())) throw new Error('Review timing is waiting to sync. Reconnect and try again.');
    acceptState(await api<AppState>(`/api/lessons/${encodeURIComponent(state.currentLesson.id)}/discuss`, 'POST'));
  });
  const startLesson = (demo = false, draft?: FeedbackDraft) => mutate('start', async () => {
    if (!state) return;
    if (discussing) acceptState(await api<AppState>('/api/cancel', 'POST'));
    if (!(await flushReviewSessions())) throw new Error('Review timing is waiting to sync. Reconnect and try again.');
    if (draft) await saveCompletion(draft);
    if (demo && state.settings.provider !== 'demo') acceptState(await api<AppState>('/api/settings', 'PUT', { ...state.settings, provider: 'demo' }));
    acceptState(await api<AppState>('/api/plan', 'POST'));
    setReviewId(null);
    setView('practice');
    setNow(Date.now());
  });
  const submit = useCallback(async (answer: Answer) => {
    if (!state?.question || reviewId || view !== 'practice' || busy.current || connectionError) return;
    const question = state.question;
    const elapsedMs = Math.max(0, Math.round(readAnswerTime()));
    setAnswerFeedback(null);
    uncertainAnswer.current = question.id;
    await mutate('answer', async () => {
      const result = await api<{ state: AppState; review: Review }>('/api/answers', 'POST', { exerciseId: question.id, answer, elapsedMs });
      acceptState(result.state);
      uncertainAnswer.current = null;
      setLastReviewId(result.review.attempt.id);
    });
  }, [state, reviewId, view, connectionError, acceptState, mutate, readAnswerTime]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(event.key)) return;
      if ((event.target as HTMLElement)?.closest('input, textarea, select, button, a, summary, pre, dialog, [contenteditable="true"]') || window.getSelection()?.toString()) return;
      if (view === 'practice' && state?.question && !reviewId && !pending && !connectionError) {
        event.preventDefault();
        void submit(event.key === 'ArrowLeft' ? 'buggy' : event.key === 'ArrowRight' ? 'correct' : 'idk');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [submit, view, state?.question, reviewId, pending, connectionError]);
  const flag = (item: Review) => void mutate('flag', async () => acceptState(await api<AppState>(`/api/attempts/${encodeURIComponent(item.attempt.id)}/flag`, 'POST', { flagged: !item.attempt.flagged, reason: 'flawed-question' })));
  const pointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (pending || reviewId || connectionError || event.button !== 0 || !event.isPrimary) return;
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
    pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId, horizontal: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { pointer.current = null; return; }
      if (Math.abs(dx) < 7 || Math.abs(dx) <= Math.abs(dy)) return;
      start.horizontal = true;
      setDragging(true);
    }
    setDrag(Math.max(-180, Math.min(180, dx)));
  };
  const cancelDrag = () => { pointer.current = null; setDrag(0); setDragging(false); };
  const pointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointer.current;
    cancelDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (start?.horizontal && start.id === event.pointerId && Math.abs(event.clientX - start.x) > 72) void submit(event.clientX > start.x ? 'correct' : 'buggy');
  };
  const lesson = state?.currentLesson || null;
  const changeView = (next: typeof view) => { setReviewId(null); setView(next); };
  const answerDisabled = Boolean(pending) || Boolean(connectionError) || Boolean(reviewId);
  const previousAnswer = lastReview && !running ? <PreviousAnswer review={lastReview} disabled={Boolean(pending)} onReview={() => setReviewId(lastReview.attempt.id)} /> : null;

  return <div className={`app-shell view-${view}${view === 'practice' && state?.question ? ' has-active-card' : ''}`}>
    <header className="app-header"><button className="brand" onClick={() => changeView('practice')} aria-label="Code Swipe home"><span className="brand-mark"><Code2 size={24} /></span><span>code<span className="brand-light">swipe</span></span></button><nav aria-label="Main navigation">{([{ id: 'practice', label: 'Practice', icon: Code2 }, { id: 'notebook', label: 'Notebook', icon: BookOpen }, { id: 'settings', label: 'Setup', icon: Settings2 }] as const).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => changeView(id)} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined}><Icon size={17} /><span>{label}</span></button>)}</nav><span className="local-status"><span className={`status-dot ${connectionError ? 'offline' : ''}`} />{connectionError ? 'Disconnected' : pending ? 'Saving…' : state ? 'Saved locally' : 'Connecting…'}</span></header>
    <main id="main-content">
      {(error || connectionError) && <div className="error-notice" role="alert"><div><strong>{connectionError ? 'Local server disconnected' : 'Couldn’t finish that action'}</strong><p>{connectionError || error}</p></div><button className="button compact quiet" onClick={() => { setError(''); void refresh(); void flushReviewSessions(); }} disabled={Boolean(pending)}>Reconnect</button></div>}
      {!state ? <div className="panel loading-state"><Terminal size={34} /><h1>{connectionError ? 'Reconnect to continue' : 'Opening your notebook…'}</h1><p className="muted">{connectionError ? 'Start the Code Swipe server, then reconnect.' : 'Loading your saved lessons.'}</p><button className="button quiet" onClick={() => void refresh()}>Retry connection</button></div>
        : view === 'settings' ? <SettingsPanel state={state} settings={settings} setSettings={setSettings} pending={Boolean(pending) || running} onSave={() => void mutate('settings', async () => acceptState(await api<AppState>('/api/settings', 'PUT', settings)))} />
        : view === 'notebook' ? <Notebook state={state} selectedId={selectedLessonId} onSelect={setSelectedLessonId} onReview={setReviewId} onPractice={() => changeView('practice')} />
        : <div className="practice-layout"><div className="practice-main">
          {state.question && lesson ? <>
            <div className="lesson-progress"><div><span className="eyebrow">Lesson {state.lessons.length}</span><span className="muted">Card {lesson.answered + 1} of {lesson.total}</span></div><div className="progress-track" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={lesson.total} aria-valuenow={lesson.answered} data-testid="lesson-progress"><span style={{ width: `${lesson.answered / lesson.total * 100}%` }} /></div></div>
            <div className="card-stack"><div className="card-stack-back" aria-hidden="true" /><article className={`exercise-card ${dragging ? 'dragging' : ''}`} data-testid="exercise-card" data-question-id={state.question.id} style={{ transform: `translateX(${drag}px) rotate(${drag * .055}deg)` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} aria-busy={pending === 'answer'}>
              {drag > 25 && <div className="swipe-stamp correct" data-testid="swipe-correct-overlay">CORRECT</div>}{drag < -25 && <div className="swipe-stamp buggy" data-testid="swipe-buggy-overlay">BUGGY</div>}
              <div className="exercise-intro"><div className="section-heading"><span className="small-label">Target objective</span><Badge>JavaScript</Badge></div><h1 ref={heading} tabIndex={-1}>{state.question.title}</h1><div className="specification"><p>{state.question.specification}</p></div></div><Code code={state.question.code} /><div className="card-footnote"><span>↔ Drag to decide</span><span>Buggy ← → Correct</span></div>
            </article></div>
            {previousAnswer}
            <div className="answer-buttons"><button className="answer-button buggy" onClick={() => void submit('buggy')} disabled={answerDisabled} data-testid="answer-buggy"><X size={20} /><span>Buggy</span><kbd>←</kbd></button><button className="answer-button unsure" onClick={() => void submit('idk')} disabled={answerDisabled} data-testid="answer-idk" title="I don’t know · ungraded"><span>IDK</span><kbd>↓</kbd></button><button className="answer-button correct" onClick={() => void submit('correct')} disabled={answerDisabled} data-testid="answer-correct"><Check size={20} /><span>Correct</span><kbd>→</kbd></button></div>
            <p className="keyboard-hint" aria-live="polite">{pending === 'answer' ? 'Saving answer…' : 'Swipe, use arrow keys, or tap a button.'}</p>
          </> : running && !discussing && state.job ? <section className="panel planning-state" data-testid="planning-state"><div className="planning-icon"><Sparkles size={28} /></div><div className="eyebrow">{PROVIDER_NAMES[state.settings.provider]} is planning</div><h1 ref={heading} tabIndex={-1}>Preparing your lesson</h1><div className="job-stage" role="status"><LoaderCircle size={20} className="spin" /><div><strong>{state.job.stage}</strong><p>{state.job.message || 'Working on your next lesson…'}</p></div></div><p className="fine-print">Elapsed: {Math.max(0, Math.floor((now - Date.parse(state.job.startedAt)) / 1000))}s</p><button className="button quiet" onClick={() => void mutate('cancel', async () => acceptState(await api<AppState>('/api/cancel', 'POST')))} disabled={Boolean(pending)} data-testid="cancel-plan"><X size={17} />{pending === 'cancel' ? 'Cancelling…' : 'Cancel planning'}</button></section>
            : <>
              {state.job?.status === 'error' && <div className="notice error" role="alert"><strong>{state.job.kind === 'discussion' ? 'Tutor response stopped' : 'Lesson preparation stopped'}</strong><p>{state.job.message}</p><p className="fine-print">{state.job.kind === 'discussion' ? 'Your feedback is saved. Retry or continue to the next lesson.' : 'Check Setup, then retry.'}</p></div>}
              {state.job?.status === 'cancelled' && <div className="notice">{state.job.kind === 'discussion' ? 'Follow-up cancelled. Your feedback is saved.' : 'Planning cancelled. You can try again.'}</div>}
              {lesson?.complete ? <><div className="lesson-progress"><div><span className="eyebrow">Lesson {state.lessons.length}</span><span className="muted">Complete</span></div><div className="progress-track" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={lesson.total} aria-valuenow={lesson.total} data-testid="lesson-progress"><span style={{ width: '100%' }} /></div></div><LessonComplete key={lesson.id} lesson={lesson} reviews={state.reviews.filter((item) => item.attempt.lessonId === lesson.id)} discussion={state.discussions.filter(item => item.lessonId === lesson.id).at(-1)} job={state.job} pending={pending} canPlan={!connectionError && Boolean(chosenProvider?.available)} reflective={state.settings.tutorMode === 'reflective'} onSave={(draft) => void mutate('feedback', () => saveCompletion(draft))} onDiscuss={(draft) => void discussFeedback(draft)} onCancel={() => void mutate('cancel', async () => acceptState(await api<AppState>('/api/cancel', 'POST')))} onNext={(draft) => void startLesson(false, draft)} onNotebook={() => { setSelectedLessonId(lesson.id); changeView('notebook'); }} /></>
                : <section className="welcome-panel"><Code2 size={38} /><h1 ref={heading} tabIndex={-1}>Read code. Make a call.</h1><p className="welcome-copy">Swipe left for buggy. Right for correct. IDK when you’re unsure.</p><div className="welcome-actions"><button className="button primary" onClick={() => void startLesson(false)} disabled={Boolean(pending) || Boolean(connectionError) || !chosenProvider?.available} data-testid="start-lesson">{pending === 'start' ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{state.job?.status === 'error' ? 'Retry lesson' : 'Start lesson'}<ArrowRight size={18} /></button>{state.settings.provider !== 'demo' && <button className="button quiet" onClick={() => void startLesson(true)} disabled={Boolean(pending) || Boolean(connectionError)} data-testid="try-demo"><FlaskConical size={17} /> Try demo</button>}</div><div className="current-setup"><span>{PROVIDER_NAMES[state.settings.provider]} · {state.settings.batchSize} cards</span><button className="text-button" onClick={() => changeView('settings')}>Setup<ChevronRight size={14} /></button></div>{!chosenProvider?.available && <p className="fine-print">Set up your local agent, or try the demo.</p>}</section>}
            </>}
          {!state.question && previousAnswer}
        </div></div>}
    </main>
    <div className="answer-feedback-position" role="status" aria-live="polite" aria-atomic="true">
      {answerFeedback && view === 'practice' && !review && <div key={answerFeedback.id} className={`answer-feedback ${resultTone(answerFeedback.correct)}`} data-testid="answer-feedback">
        {answerFeedback.correct === null ? <HelpCircle size={28} /> : answerFeedback.correct ? <CheckCircle2 size={28} /> : <X size={28} />}
        <div><span>Previous answer</span><strong>{quickResultLabel(answerFeedback.correct)}</strong></div>
      </div>}
    </div>
    {review && <ReviewDialog key={review.attempt.id} review={review} pending={Boolean(pending) || running} error={error || connectionError} onFlag={flag} onClose={() => setReviewId(null)} />}
  </div>;
}
