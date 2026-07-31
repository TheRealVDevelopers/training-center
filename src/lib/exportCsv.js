// Shared CSV export. Every report gets the same one-click download so the
// owner can open any of it in Excel / send it to an accountant.
export function exportCsv(filename, rows) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  // BOM so Excel opens ₹ and Indian names in the right encoding.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
