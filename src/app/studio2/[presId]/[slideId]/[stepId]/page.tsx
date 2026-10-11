'use client'
import { ClientOnly } from '../../../../ClientOnly'
import { Studio2 } from '../../../../../screens/Studio2'

/**
 * The v2 studio, on its own route.
 *
 * It lives beside `/studio` rather than replacing it, because the two do not
 * agree on the shape of an animation: this one upgrades the document on load
 * and saves v2, while the old one still edits v1. They cannot be swapped
 * until every deck in the database has been migrated in one pass.
 */
export default function Studio2Page() {
  return (
    <ClientOnly>
      <Studio2 />
    </ClientOnly>
  )
}
