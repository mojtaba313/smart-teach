'use client'
import { ClientOnly } from '../ClientOnly'
import Create from '../../screens/Create'

export default function CreatePage() {
  // `useSearchParams` inside the editor needs a Suspense boundary to render
  // while streaming.
  return (
    <ClientOnly>
      <Create />
    </ClientOnly>
  )
}
