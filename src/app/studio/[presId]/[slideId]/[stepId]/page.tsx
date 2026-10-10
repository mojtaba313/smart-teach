'use client'
import { ClientOnly } from '../../../../ClientOnly'
import Studio from '../../../../../screens/Studio'

export default function StudioPage() {
  return (
    <ClientOnly>
      <Studio />
    </ClientOnly>
  )
}
