'use client'
import { ClientOnly } from '../../ClientOnly'
import BulkImport from '../../../screens/BulkImport'

export default function BulkImportPage() {
  return (
    <ClientOnly>
      <BulkImport />
    </ClientOnly>
  )
}
