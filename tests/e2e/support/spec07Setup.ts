import { execFileSync } from 'node:child_process'
export default function setup() {
  // The Python runner refuses every container except the recorded disposable Spec 07 identity.
  execFileSync('python3', ['tests/integration/spec08-spec09-database.py', 'rebuild'], { stdio: 'inherit' })
  execFileSync('python3', ['tests/integration/spec07-browser-fixture.py'], { stdio: 'inherit' })
}
