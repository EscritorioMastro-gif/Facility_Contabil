import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callParser, ESPERA_LEITOR_MS } from './parserClient.js';

const arquivo = { buffer: Buffer.from('OFXHEADER'), originalname: 'extrato.ofx', mimetype: 'application/x-ofx' };
const lido = { format: 'ofx', transactions: [], warnings: [] };

const resposta = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('callParser — leitor dormindo no Render', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('502 enquanto acorda: tenta de novo até o leitor responder', async () => {
    fetchMock
      .mockResolvedValueOnce(resposta(502))
      .mockResolvedValueOnce(resposta(502))
      .mockResolvedValueOnce(resposta(200, lido));

    const p = callParser(arquivo);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(p).resolves.toEqual(lido);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falha de rede enquanto acorda também tenta de novo', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(resposta(200, lido));

    const p = callParser(arquivo);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(p).resolves.toEqual(lido);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('desiste depois da espera máxima, com mensagem pro usuário', async () => {
    fetchMock.mockImplementation(async () => resposta(502));

    const p = callParser(arquivo);
    const conferido = expect(p).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('pode estar acordando'),
    });
    await vi.advanceTimersByTimeAsync(ESPERA_LEITOR_MS + 10_000);
    await conferido;

    const chamadas = fetchMock.mock.calls.length;
    expect(chamadas).toBeGreaterThan(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(chamadas); // parou de tentar
  });

  it('erro de leitura (422) não repete', async () => {
    fetchMock.mockResolvedValueOnce(resposta(422, { error: 'Formato não reconhecido', code: 'formato' }));

    await expect(callParser(arquivo)).rejects.toMatchObject({ status: 422, message: 'Formato não reconhecido' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tempo esgotado (leitor acordado mas lento) não repete', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    await expect(callParser(arquivo)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
