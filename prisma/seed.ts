import { prisma } from '../src/server/db'
import { questionToRow, presentationToRow } from '../src/server/mapping'
import { kinematicsLesson } from '../src/lessons/kinematics'
import { seedQuestionBank } from '../src/sample'

/** Loads the built-in lesson and question bank into the database. */
async function main() {
  const deck = kinematicsLesson()
  const row = presentationToRow(deck)
  await prisma.presentation.upsert({
    where: { id: row.id },
    create: row,
    update: { ...row, createdAt: undefined },
  })
  console.log(`presentation: ${deck.title}`)

  const questions = seedQuestionBank()
  for (const q of questions) {
    const r = questionToRow(q)
    await prisma.question.upsert({
      where: { id: r.id },
      create: r,
      update: { ...r, createdAt: undefined },
    })
  }
  console.log(`questions: ${questions.length}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
