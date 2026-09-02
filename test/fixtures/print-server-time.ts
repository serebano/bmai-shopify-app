// Prints formatServerTime(argv[2]) — run under different TZ envs by
// test/formatTime.test.ts to prove the SSR render is time-zone independent
// (the hydration invariant behind #retrain-500).
import { formatServerTime } from "../../app/lib/formatTime";
process.stdout.write(formatServerTime(process.argv[2]));
