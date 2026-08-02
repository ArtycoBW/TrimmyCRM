import http from "k6/http";
import { check, sleep } from "k6";

function positiveNumber(name, fallback) {
  const value = Number(__ENV[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const profile = __ENV.LOAD_PROFILE || "smoke";
const smokeVus = positiveNumber("VUS", 2);
const smokeDuration = __ENV.DURATION || "30s";
const loadVus = positiveNumber("LOAD_VUS", 10);
const holdDuration = __ENV.HOLD_DURATION || "2m";
const p95Milliseconds = positiveNumber("P95_MS", 1000);
const errorRate = __ENV.MAX_ERROR_RATE || "0.01";

export const options = {
  scenarios: {
    public_read: profile === "load"
      ? {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: "30s", target: loadVus },
            { duration: holdDuration, target: loadVus },
            { duration: "30s", target: 0 },
          ],
        }
      : {
          executor: "constant-vus",
          vus: smokeVus,
          duration: smokeDuration,
        },
  },
  thresholds: {
    http_req_failed: [`rate<${errorRate}`],
    http_req_duration: [`p(95)<${p95Milliseconds}`],
  },
};

const baseUrl = __ENV.BASE_URL || "http://localhost:8080";
const tenantHost = __ENV.TENANT_HOST;
const paths = (__ENV.PATHS || "/healthz,/api/v1/plans")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
const thinkTimeSeconds = positiveNumber("THINK_TIME_SECONDS", 1);

export default function () {
  const params = tenantHost ? { headers: { Host: tenantHost } } : {};
  for (const path of paths) {
    const response = http.get(`${baseUrl}${path}`, params);
    check(response, { [`${path} is 200`]: (value) => value.status === 200 });
  }
  sleep(thinkTimeSeconds);
}

