import { notifyQuestion } from '../notifications';
import type { Tool } from './index';

export type QuestionOption = { label: string; description?: string };

export type Question = { question: string; header?: string; options: QuestionOption[]; multiSelect: boolean };

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;

type Reply = { answers: string[] } | { skipped: true } | { words: string };

// Calls waiting for the user, by call id. The reply is paused on them; nothing survives a restart,
// where the store marks the call interrupted like any other that was running.
const waiting = new Map<string, { conversationId: string; answer: (reply: Reply) => void }>();
// Replies to calls that show already but haven't started: earlier calls of their step still run.
const early = new Map<string, Reply>();

function report(questions: Question[], reply: Reply) {
  if ('skipped' in reply) return 'The user skipped the question without answering. Go on with your best judgment, and say what you assumed.';
  if ('words' in reply) return `The user replied in their own words:\n\n${reply.words}`;
  const lines = questions.map(
    (q, i) => `${questions.length > 1 ? `${i + 1}. ` : ''}${q.question}\nAnswer: ${reply.answers[i]?.trim() || '(no answer)'}`
  );
  return `The user answered:\n\n${lines.join('\n\n')}`;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The questions of an ask_user call, as far as they parse. Works on calls still being written. */
export function questionsOf(input: Record<string, unknown>): Question[] {
  // Models now and then flatten a single question into the top level.
  const list: any[] = Array.isArray(input.questions) ? input.questions : text(input.question) ? [input] : [];
  return list.slice(0, MAX_QUESTIONS).flatMap((q): Question[] => {
    if (!q || typeof q !== 'object' || !text(q.question)) return [];
    const options: QuestionOption[] = (Array.isArray(q.options) ? q.options : [])
      .flatMap((o: any): QuestionOption[] => {
        const label = typeof o === 'string' ? o.trim() : text(o?.label);
        const description = typeof o === 'string' ? '' : text(o?.description);
        return label ? [{ label, ...(description ? { description } : {}) }] : [];
      })
      .slice(0, MAX_OPTIONS);
    const header = text(q.header);
    return [{ question: text(q.question), ...(header ? { header } : {}), options, multiSelect: !!q.multi_select && options.length > 1 }];
  });
}

export const askUser: Tool = {
  name: 'ask_user',
  description:
    'Ask the user one or more questions and wait for their answers: to clarify a request that could reasonably mean different things, or to let them make a decision that is theirs to make. ' +
    'Each question can offer options to pick from; the user can always answer in their own words instead. Returns their answers.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: `1-${MAX_QUESTIONS} questions, asked together.`,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The complete question.' },
            header: { type: 'string', description: 'A label of a word or two shown above the question, e.g. "Format".' },
            options: {
              type: 'array',
              description: `Up to ${MAX_OPTIONS} choices. Leave out for an open question.`,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'The choice, in a few words.' },
                  description: { type: 'string', description: 'What choosing it means, when the label alone does not say.' },
                },
                required: ['label'],
              },
            },
            multi_select: { type: 'boolean', description: 'Let the user pick several options. Default false.' },
          },
          required: ['question'],
        },
      },
    },
    required: ['questions'],
  },
  async run(input, { conversationId, callId, signal }) {
    const questions = questionsOf(input);
    if (!questions.length) throw new Error('Pass at least one question in "questions", each with its "question" text.');
    const given = early.get(callId);
    early.delete(callId);
    if (given) return { output: report(questions, given) };
    if (signal.aborted) throw new Error('Stopped before the user answered.');
    void notifyQuestion(conversationId, questions[0].question);
    const reply = await new Promise<Reply>((resolve, reject) => {
      const onAbort = () => {
        waiting.delete(callId);
        reject(new Error('Stopped before the user answered.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      waiting.set(callId, {
        conversationId,
        answer: (reply) => {
          signal.removeEventListener('abort', onAbort);
          waiting.delete(callId);
          resolve(reply);
        },
      });
    });
    return { output: report(questions, reply) };
  },
};

function reply(callId: string, r: Reply) {
  const call = waiting.get(callId);
  if (call) call.answer(r);
  else early.set(callId, r);
}

/** Answers the call's questions, one answer each (empty for none). */
export const answerQuestions = (callId: string, answers: string[]) => reply(callId, { answers });

export const skipQuestions = (callId: string) => reply(callId, { skipped: true });

/**
 * Answers the chat's waiting call with a message the user typed in the composer rather than in
 * the question card. False when the chat has no call waiting.
 */
export function answerInWords(conversationId: string, words: string) {
  for (const call of waiting.values()) {
    if (call.conversationId !== conversationId) continue;
    call.answer({ words });
    return true;
  }
  return false;
}
