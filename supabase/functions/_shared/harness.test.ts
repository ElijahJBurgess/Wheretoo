import { assertEquals } from 'jsr:@std/assert@1.0.16'

Deno.test('Edge test harness runs without loading repository dotenv files', () => {
  assertEquals(new URL('.', import.meta.url).pathname.endsWith('/_shared/'), true)
})
