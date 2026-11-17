/**
 * Generic understanding orchestrator.
 *
 * The engine knows how to run model tasks over an item; it does not know what
 * those tasks *mean*. A consumer supplies domain logic as injected functions.
 * That is the whole separation: NovrPulse's eight-function tagging and Nigerian
 * entity rules live in the consumer, not here.
 *
 * A consumer provides an `analysers` object of async functions, each receiving
 * `(item, ctx)` and returning anything serialisable:
 *
 *   {
 *     classify: (item, {llm}) => ({ tags: [...], severity: n }),
 *     summarise: (item, {llm}) => ({ summary, whatItMeans }),
 *     extractEntities: (item, {llm}) => [{ name, type, role }],
 *   }
 *
 * The orchestrator runs them (in parallel, bounded) and returns a merged
 * `{ ...results, errors }` object. It does not persist: the consumer decides
 * where the output goes.
 */

/**
 * Run the configured analysers for one item.
 *
 * @param {import('../parse/item.js').NormalisedItem & {sourceId?:string}} item
 * @param {object} params
 * @param {Record<string, (item:object, ctx:object)=>Promise<any>>} params.analysers
 * @param {object} params.llm
 * @param {object} [params.logger]
 * @param {number} [params.concurrency=3]
 * @returns {Promise<{ results:Record<string,any>, errors:Record<string,string> }>}
 */
export async function analyseItem(item, { analysers, llm, logger, concurrency = 3 } = {}) {
  if (!analysers || typeof analysers !== 'object') throw new Error('analyseItem: analysers is required');

  const entries = Object.entries(analysers);
  const results = {};
  const errors = {};
  const ctx = { llm, logger };

  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, entries.length)) }, async () => {
    while (next < entries.length) {
      const i = next;
      next += 1;
      const [name, fn] = entries[i];
      try {
        results[name] = await fn(item, ctx);
      } catch (err) {
        errors[name] = err.message;
        logger?.warn?.({ analyser: name, message: err.message }, 'analyser failed');
      }
    }
  });
  await Promise.all(workers);

  return { results, errors };
}

export default { analyseItem };
