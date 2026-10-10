'use client'
import { ClientOnly } from '../../ClientOnly'
import View from '../../../screens/View'

export default function ViewPage() {
  return (
    <ClientOnly>
      <View />
    </ClientOnly>
  )
}
