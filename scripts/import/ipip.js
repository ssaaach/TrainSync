#!/usr/bin/env node
// npm run import:ipip
// Downloads the Open Psychometrics IPIP-FFM raw data (~150 MB, cached in
// ml/data/raw/ipip/) and scores it with ml/ipip.py. Used only to sample
// realistic Big Five distributions for synthetic users.
const { cachedDownload, parseArgs } = require('./lib');
const { runPython } = require('../py');

const URL = 'https://openpsychometrics.org/_rawdata/IPIP-FFM-data-8Nov2018.zip';

(async () => {
  const args = parseArgs();
  try {
    await cachedDownload(URL, 'ipip/IPIP-FFM-data-8Nov2018.zip', { refresh: Boolean(args.refresh) });
  } catch (err) {
    console.error(`✖ IPIP-FFM download failed (${err.message}). Synthetic users cannot sample real Big Five rows; re-run when online.`);
    process.exit(2);
  }
  process.exit(runPython(['ml/ipip.py']));
})();
