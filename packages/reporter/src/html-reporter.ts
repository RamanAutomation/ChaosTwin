import { ExperimentReportSchema, parseWithSchema } from '@chaostwin/contracts';
import { escapeHtml } from './escape-html.js';

const STYLE = `
body { margin: 0; font: 16px/1.45 Segoe UI, sans-serif; color: #1c1917; background: #f6f3ee; }
main { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 1.6rem; margin-bottom: 0.2rem; }
h2 { font-size: 1.05rem; margin-top: 2rem; }
.status { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #e7e5e4; }
table { width: 100%; border-collapse: collapse; background: white; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e7e5e4; }
th { width: 28%; }
.missing { color: #9a3412; }
`;

export function renderHtmlReport(report: unknown): string {
  const parsed = parseWithSchema(ExperimentReportSchema, report, 'Experiment report');
  const rows = [
    ['Experiment', `${parsed.experimentName} (${parsed.experimentId})`],
    ['Product', `${parsed.product} ${parsed.productVersion}`],
    ['Status', parsed.status],
    ['Started', parsed.startedAt],
    ['Ended', parsed.endedAt],
    ['Duration', `${parsed.durationMs} ms`],
    ['Device', `${parsed.device.serial} (${parsed.device.kind})`],
    ['AVD', parsed.device.avdName ?? 'unknown'],
    ['Android', parsed.device.androidVersion ?? 'unknown'],
    ['App', `${parsed.app.packageName} ${parsed.app.version ?? ''}`.trim()],
    ['Activity', parsed.app.activity],
    ['Fault', `${parsed.fault.kind} ${parsed.fault.status} ${parsed.fault.mode}`],
    ['Fault window', `${parsed.fault.startedAt ?? 'not started'} to ${parsed.fault.endedAt ?? 'not finished'}`],
    ['Restored', parsed.fault.restored ? 'yes' : 'no'],
  ];
  const stepRows = parsed.workflow.steps
    .map(
      (step) =>
        `<tr><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.type)}</td><td>${escapeHtml(step.status)}</td><td>${escapeHtml(step.message)}</td></tr>`,
    )
    .join('');
  const assertionRows = parsed.assertions
    .map(
      (assertion) =>
        `<tr><td>${escapeHtml(assertion.id)}</td><td>${escapeHtml(assertion.status)}</td><td>${escapeHtml(assertion.message)}</td><td>${escapeHtml(assertion.evidenceRefs.join(', '))}</td></tr>`,
    )
    .join('');
  const files = parsed.evidence.files.map((file) => `<li>${escapeHtml(file)}</li>`).join('');
  const missing = parsed.evidence.missing
    .map((item) => `<li class="missing">${escapeHtml(item.kind)}: ${escapeHtml(item.message)}</li>`)
    .join('');
  const steps = parsed.reproduction.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  const failure = parsed.failure
    ? `<h2>Failure</h2><p>${escapeHtml(parsed.failure.summary)}</p><p>${escapeHtml(parsed.failure.details)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(parsed.experimentId)} ${escapeHtml(parsed.status)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(parsed.product)}</h1>
<p class="status">${escapeHtml(parsed.status)}</p>
<h2>Summary</h2>
<table>
${rows.map(([label, value]) => `<tr><th>${escapeHtml(label ?? '')}</th><td>${escapeHtml(value ?? '')}</td></tr>`).join('')}
</table>
<h2>Workflow ${escapeHtml(parsed.workflow.id)}</h2>
<table>
<tr><th>Step</th><th>Type</th><th>Status</th><th>Detail</th></tr>
${stepRows}
</table>
<h2>Fault</h2>
<p>${escapeHtml(parsed.fault.message)}</p>
<h2>Assertions</h2>
<table>
<tr><th>Assertion</th><th>Status</th><th>Detail</th><th>Evidence</th></tr>
${assertionRows}
</table>
<h2>Evidence</h2>
<p>${escapeHtml(parsed.evidence.directory ?? 'No evidence directory was created.')}</p>
<ul>${files}</ul>
<ul>${missing}</ul>
${failure}
<h2>Reproduction</h2>
<ol>${steps}</ol>
</main>
</body>
</html>
`;
}
