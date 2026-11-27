import { performance } from 'node:perf_hooks';

const cases = [
  {
    id: 'regional-audit',
    cyber: true,
    region: 'NG',
    ready: true,
    facts: ['Lagos', '18', '11'],
    source:
      'The Lagos Civic Archive said 18 offices took part in a review of staff access during May. Its published report separates the 11 offices that finished the exercise from seven that asked for more time. The review covered accounts used to consult historical records. It did not examine the public catalogue. The archive plans to publish completion figures in July and said it has observed no data loss. The figures describe offices rather than people.',
  },
  {
    id: 'uncertain-attribution',
    cyber: true,
    region: 'GLOBAL',
    ready: true,
    facts: ['Finland', 'four', 'March'],
    source:
      'A library consortium in Finland reported that four reading rooms temporarily lost access to their booking systems on 12 March. A provider restored service later that day. The consortium is assessing whether an unauthorised login contributed. The supplier has not established a cause or identified an actor. Printed bookings were available during the disruption. The review covers only the Finnish locations. The consortium promised an update after its independent review.',
  },
  {
    id: 'funding-geography',
    cyber: true,
    region: 'AF',
    ready: true,
    facts: ['Kenya', 'Ghana', 'pilot'],
    source:
      'An identity security cooperative in Kenya announced a grant of 600,000 euros for a pilot with two libraries in Ghana. The funder says the award supports staff training and a shared audit of account permissions. A memorandum provides for a six-month trial. Neither library has deployed the proposed identity system yet. The cooperative said rollout beyond the pilot would depend on feedback, and did not announce any other countries or commercial partners.',
  },
  {
    id: 'ordinary-business',
    cyber: false,
    region: 'AF',
    ready: false,
    facts: [],
    source:
      'A café in Accra changed its opening hours for the rainy season. Its new timetable includes Saturday breakfast. The notice discusses staffing and menus only.',
  },
  {
    id: 'headline-only',
    cyber: true,
    region: 'GLOBAL',
    ready: false,
    facts: [],
    source:
      'A new cybersecurity report is coming. Subscribe for the details. No findings or regional details are available.',
  },
];
const instruction =
  'Assess the supplied source for a cybersecurity newsroom. Return only a JSON object with cyber (boolean), region (NG for Nigeria, AF for elsewhere in Africa, GLOBAL otherwise), ready (true only for substantive cybersecurity reporting), and sections (array of {heading, paragraphs:[text]}). Use two distinct short sections when ready and an empty array otherwise. Preserve uncertainty, numbers, place and attribution. Add no details absent from the source. Use original third-person editorial prose.';
const local = process.argv.includes('--ollama');
const endpoint = local
  ? 'http://127.0.0.1:11439'
  : process.env.NP_LLM_BASE_URL || process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const model = local
  ? process.argv[process.argv.indexOf('--ollama') + 1]
  : process.env.NP_FRONTIER_MODEL || 'nvidia/nemotron-3.5-bolt-e4b';
const key = local ? null : process.env.NP_LLM_API_KEY || process.env.NVIDIA_API_KEY;
if (!model || (!local && !key)) throw Error('A configured model is required.');
if (!local && new URL(endpoint).origin !== 'https://integrate.api.nvidia.com')
  throw Error('This benchmark expects the NVIDIA production endpoint.');
for (const c of cases) {
  const start = performance.now();
  try {
    const messages = [
      { role: 'system', content: instruction },
      { role: 'user', content: c.source },
    ];
    const result = await fetch(endpoint.replace(/\/$/, '') + (local ? '/api/chat' : '/chat/completions'), {
      method: 'POST',
      signal: AbortSignal.timeout(180000),
      headers: { 'content-type': 'application/json', ...(!local && { authorization: 'Bearer ' + key }) },
      body: JSON.stringify(
        local
          ? {
              model,
              messages,
              stream: false,
              format: 'json',
              think: false,
              options: { temperature: 0, num_predict: 650 },
            }
          : { model, messages, temperature: 0, max_tokens: 650, response_format: { type: 'json_object' } },
      ),
    });
    if (!result.ok) throw Error('HTTP ' + result.status);
    const payload = await result.json();
    const raw = local ? payload.message?.content : payload.choices?.[0]?.message?.content;
    const out = JSON.parse((raw ?? '').trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, ''));
    const text = JSON.stringify(out.sections || []);
    const sections =
      Array.isArray(out.sections) &&
      (c.ready
        ? out.sections.length >= 2 &&
          out.sections.every(
            (s) =>
              typeof s.heading === 'string' &&
              s.heading.trim() &&
              Array.isArray(s.paragraphs) &&
              s.paragraphs.some((p) => typeof p === 'string' && p.length >= 25),
          )
        : out.sections.length === 0);
    const preserved = c.facts.filter(
      (s) => text.toLowerCase().includes(s.toLowerCase()) || (s === 'four' && /\b4\b/.test(text)),
    );
    console.log(
      JSON.stringify({
        id: c.id,
        model,
        ms: Math.round(performance.now() - start),
        valid: true,
        cyber: out.cyber === c.cyber,
        region: out.region === c.region,
        ready: out.ready === c.ready,
        sections: Boolean(sections),
        factHits: preserved.length,
        facts: c.facts.length,
        copy: out.sections,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        id: c.id,
        model,
        ms: Math.round(performance.now() - start),
        valid: false,
        error: /^HTTP \d+$/.test(error.message) ? error.message : error.name,
      }),
    );
  }
}
