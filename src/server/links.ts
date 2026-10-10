import { prisma } from './db'
import type { Presentation } from '../types'

/**
 * Keep `QuizLink` in step with the deck.
 *
 * A quiz block that mirrors a bank question is what lets the presenter show
 * that question's answer key. The link is derived data, so it is rebuilt from
 * the document every time a deck is saved rather than trusted from the client.
 */
export async function syncQuizLinks(presentationId: string, pres: Presentation) {
  const links: { id: string; stepId: string; presentation: string; question: string }[] = []
  for (const slide of pres.slides ?? []) {
    for (const step of slide.steps ?? []) {
      if (step.kind === 'quiz' && step.bankId) {
        links.push({
          id: `${presentationId}:${step.id}`,
          stepId: step.id,
          presentation: presentationId,
          question: step.bankId,
        })
      }
    }
  }
  const wanted = new Set(links.map((l) => l.id))
  await prisma.quizLink.deleteMany({
    where: { presentation: presentationId, id: { notIn: [...wanted] } },
  })
  for (const link of links) {
    await prisma.quizLink.upsert({ where: { id: link.id }, create: link, update: link })
  }
}