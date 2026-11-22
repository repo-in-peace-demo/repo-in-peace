/**
 * The PR function on Vercel (bury-and-resurrect design): GET answers which demos have working actions; POST opens a Bury or Resurrect
 * pull request on a demo fork. The work is in server/pr/handler.ts. The dependencies are made once per instance, so the throttle and
 * the data file cache last as long as the instance does.
 */
import { modeFromVercelEnv, readConfig } from '../server/pr/config';
import { graveyardReader } from '../server/pr/graveyards';
import { githubClient } from '../server/pr/github';
import { clientKeyFromHeaders, createFakePrs, handlePr, type PrDeps } from '../server/pr/handler';
import { Throttle } from '../server/pr/limits';

let deps: PrDeps | undefined;
function dependencies(): PrDeps {
  if (deps) return deps;
  const graveyards = graveyardReader();
  deps = {
    config: readConfig(process.env, modeFromVercelEnv(process.env['VERCEL_ENV'])),
    github: (token) => githubClient(token),
    readGraveyard: graveyards.read,
    listGraveyards: graveyards.list,
    throttle: new Throttle(),
    clientKey: clientKeyFromHeaders,
    log: (line) => console.log(line),
    fake: createFakePrs(),
  };
  return deps;
}

export function GET(request: Request): Promise<Response> {
  return handlePr(request, dependencies());
}

export function POST(request: Request): Promise<Response> {
  return handlePr(request, dependencies());
}
