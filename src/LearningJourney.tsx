import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, Sparkles, X } from 'lucide-react';
import type { DirectionSet, LearningArc, LearningDirection, LearningJourney, LessonSummary, Review } from './types';

export function CurriculumOutline({ arc }: { arc: LearningArc }) {
  const latest = arc.revisions.at(-1)?.review;
  const remaining = (latest?.remainingLessons ?? arc.plan.lessons).filter(step => !arc.lessons.some(link => link.stepId === step.id));
  return <div className="curriculum-outline">
    <p>{arc.plan.goal}</p>
    <h3>What you’ll develop</h3><ul>{arc.plan.outcomes.map(outcome => <li key={outcome.id}>{outcome.description}</li>)}</ul>
    {latest && <div className="notice"><strong>{arc.status === 'complete' ? 'Curriculum complete' : 'Progress so far'}</strong><p>{latest.summary}</p></div>}
    {remaining.length > 0 && <><h3>{arc.lessons.length ? 'Remaining lessons' : 'Your lesson outline'}</h3><ol className="curriculum-steps">{remaining.map((step, index) => <li key={step.id}>
      <span className="step-number">{arc.lessons.length + index + 1}</span><div><h4>{step.title}</h4><p>{step.objective}</p><small>{step.ideas.join(' · ')}</small><details className="plain-details"><summary>How this lesson helps</summary><p>{step.teaching}</p><p>{step.successEvidence}</p></details></div>
    </li>)}</ol></>}
    <details className="plain-details"><summary>When we’ll move on</summary><p>{arc.plan.finishWhen}</p><h4>Later review</h4><ul>{arc.plan.laterChecks.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    {arc.revisions.length > 0 && <details className="plain-details"><summary>Plan changes & learning evidence</summary>{arc.revisions.map(revision => <section className="curriculum-revision" key={revision.id}><h4>{new Date(revision.createdAt).toLocaleDateString()} · {revision.review.decision === 'complete' ? 'Completed' : 'Plan reviewed'}</h4><p>{revision.review.reason}</p><ul>{revision.review.outcomes.map(outcome => <li key={outcome.outcomeId}><strong>{arc.plan.outcomes.find(item => item.id === outcome.outcomeId)?.description}</strong> · {outcome.status.replace('-', ' ')}<p>{outcome.explanation}</p><small>{outcome.attemptIds.length} supporting or relevant answers cited</small></li>)}</ul><p>{revision.review.retention}</p></section>)}</details>}
  </div>;
}

function DirectionPreview({ direction, recommended, pending, onChoose, onClose }: { direction: LearningDirection; recommended: boolean; pending: boolean; onChoose: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.current?.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={dialog} className="review-dialog direction-preview" aria-labelledby="direction-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="review-dialog-inner"><header className="review-dialog-header"><div><span className="eyebrow">Explore a direction{recommended ? ' · Recommended' : ''}</span><h2 id="direction-title">{direction.title}</h2></div><button className="icon-button" aria-label="Close direction preview" onClick={onClose}><X size={22} /></button></header>
      <div className="review-dialog-body"><p className="preserve-lines">{direction.preview.description}</p><h3>A small example</h3><pre className="direction-example">{direction.preview.example}</pre><p>{direction.preview.explanation}</p><h3>What you’ll learn</h3><p>{direction.goal}</p><h3>Why try this next?</h3><p>{direction.why}</p><p className="fine-print">{direction.novelty}</p>
        {direction.preview.links.length > 0 && <><h3>More reading</h3><ul className="guide-links">{direction.preview.links.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.title} ↗</a></li>)}</ul></>}
      </div><footer className="review-dialog-footer"><button className="button quiet" onClick={onClose}>Back to choices</button><button className="button primary" disabled={pending} onClick={onChoose}>Choose this direction<ArrowRight size={17} /></button></footer>
    </div>
  </dialog>;
}

export function DirectionChooser({ choices, completed, pending, onChoose, onPropose }: { choices: DirectionSet | null; completed?: LearningArc; pending: boolean; onChoose: (id: string) => void; onPropose: () => void }) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = choices?.options.find(item => item.id === previewId);
  return <section className="learning-directions" data-testid="learning-directions">
    {completed && <details className="panel completed-curriculum"><summary><CheckCircle2 size={18} />Completed: {completed.plan.title}</summary><CurriculumOutline arc={completed} /></details>}
    <div className="page-intro"><div><div className="eyebrow">Your next curriculum</div><h1>Where shall we go next?</h1><p className="muted">Choose an idea to develop over a few short lessons. Preview any direction, or let your tutor choose.</p></div></div>
    {!choices ? <section className="panel"><p>Your tutor will suggest three different areas, with one recommendation based on your learning so far.</p><button className="button primary" data-testid="propose-directions" disabled={pending} onClick={onPropose}><Sparkles size={17} />Explore new directions</button></section> : <>
      <div className="direction-options">{choices.options.map(option => <article className={`panel direction-option ${option.id === choices.recommendedId ? 'recommended' : ''}`} key={option.id}>
        <div className="eyebrow">{option.id === choices.recommendedId ? <><Sparkles size={14} /> Recommended</> : 'Another direction'}</div><h2>{option.title}</h2><p>{option.summary}</p><p className="fine-print">{option.contexts.join(' · ')}</p><div className="direction-actions"><button className="button quiet" onClick={() => setPreviewId(option.id)} data-testid="preview-direction"><BookOpen size={16} />Explore<ChevronRight size={16} /></button><button className="button primary" disabled={pending} onClick={() => onChoose(option.id)} data-testid="choose-direction">Choose<ArrowRight size={16} /></button></div>
      </article>)}</div><p className="recommendation-note">{choices.recommendation}</p><div className="direction-footer"><button className="button quiet" disabled={pending} onClick={() => onChoose(choices.recommendedId)} data-testid="choose-for-me"><Sparkles size={16} />Choose for me</button><button className="text-button" disabled={pending} onClick={onPropose}>Suggest different directions</button></div>
    </>}
    {preview && choices && <DirectionPreview direction={preview} recommended={preview.id === choices.recommendedId} pending={pending} onClose={() => setPreviewId(null)} onChoose={() => { setPreviewId(null); onChoose(preview.id); }} />}
  </section>;
}

export function CurriculumReady({ arc, pending, onStart }: { arc: LearningArc; pending: boolean; onStart: () => void }) {
  return <section className="panel curriculum-ready" data-testid="curriculum-ready"><div className="eyebrow">A few lessons, one goal</div><h1>{arc.plan.title}</h1><CurriculumOutline arc={arc} /><p className="fine-print">Your tutor adjusts future lessons as you go. Guides and examples are available before practice.</p><button className="button primary" disabled={pending} onClick={onStart} data-testid="prepare-curriculum-lesson">Prepare {arc.lessons.length ? 'next' : 'first'} lesson<ArrowRight size={17} /></button></section>;
}

export function CurriculumHistory({ journey }: { journey?: LearningJourney }) {
  const arcs = journey?.arcs.filter(arc => arc.status !== 'legacy') ?? [];
  if (!arcs.length) return null;
  return <section className="curriculum-history"><h2>Your curricula</h2>{[...arcs].reverse().map(arc => <details className="panel" key={arc.id}><summary><span>{arc.plan.title}</span><span className="fine-print">{arc.status === 'complete' ? 'Complete' : 'In progress'} · {arc.lessons.length} {arc.lessons.length === 1 ? 'lesson' : 'lessons'} prepared</span></summary><CurriculumOutline arc={arc} /></details>)}</section>;
}

export function LegacyLearning({ lessons, reviews, onReview, onSelect }: { lessons: LessonSummary[]; reviews: Review[]; onReview: (id: string) => void; onSelect: (id: string) => void }) {
  return <section className="panel legacy-learning" data-testid="legacy-learning"><div className="eyebrow">Your earlier practice</div><h2>Legacy learning</h2><p>{reviews.length} answers from {lessons.length} original sessions, collected together. Your tutor continues to use this evidence.</p><details className="plain-details"><summary>Original sessions & planning notes</summary>{lessons.map(lesson => <button className="answer-history answer-history-button" key={lesson.id} onClick={() => onSelect(lesson.id)}><span>{lesson.objective}<small>{lesson.answered}/{lesson.total} answers</small></span><ChevronRight size={16} /></button>)}</details>
    <h3>All earlier answers</h3>{[...reviews].reverse().map(review => <button className="answer-history answer-history-button" key={review.attempt.id} onClick={() => onReview(review.attempt.id)}><span className={`answer-dot ${review.attempt.correct === null ? 'neutral' : review.attempt.correct ? 'green' : 'red'}`} /><span>{review.question.title}<small>{review.attempt.answer === 'idk' ? 'IDK' : review.attempt.correct ? 'Answered correctly' : 'Answered incorrectly'}{review.attempt.flagged ? ' · excluded from evidence' : ''}</small></span><ChevronRight size={16} /></button>)}
  </section>;
}
