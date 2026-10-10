'use client'
import { ClientOnly } from '../ClientOnly'
import Bank from '../../screens/Bank'

export default function BankPage() {
  return (
    <ClientOnly>
      <Bank />
    </ClientOnly>
  )
}
