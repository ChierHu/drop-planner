// Drop Planner kit: render an HTML file to a landscape Letter PDF with the sandbox's Chromium.
// Usage: node html2pdf.cjs <in.html> <out.pdf>
const path = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('usage: node html2pdf.cjs <in.html> <out.pdf>')
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.goto('file://' + path.resolve(input), { waitUntil: 'networkidle', timeout: 90_000 })
    await page.pdf({
      path: output,
      format: 'Letter',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    })
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
