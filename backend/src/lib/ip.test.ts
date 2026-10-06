import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { ipDoCliente } from './ip.js';

function req(headers: Record<string, string>, ip = '10.0.0.1'): Request {
  return { ip, header: (n: string) => headers[n.toLowerCase()] } as unknown as Request;
}

describe('ipDoCliente', () => {
  it('usa o IP real que a Cloudflare entrega', () => {
    expect(ipDoCliente(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(ipDoCliente(req({ 'cf-connecting-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('sem Cloudflare (dev/testes) ou com valor estranho, fica o req.ip', () => {
    expect(ipDoCliente(req({}))).toBe('10.0.0.1');
    expect(ipDoCliente(req({ 'cf-connecting-ip': 'não é ip; drop table' }))).toBe('10.0.0.1');
  });
});
