// Reading a purchase back from the merchant of record (ENTITLEMENT_SPEC_
// 2026-09-18.md §4.3 and §9).
//
// The Worker never stores a buyer's name, email or address (spec §4.4); it
// reads the merchant's record at signing time and keeps nothing. This file
// is the seam that read happens through, so the route handler and its tests
// never depend on which merchant is behind it.

export interface MerchantTransaction {
  id: string;
  paid: boolean;
  product: 'founding' | 'standard';
  /** The purchase date as the merchant recorded it, YYYY-MM-DD. */
  date: string;
  /** The buyer's name, when the merchant holds one (decision 12.2). */
  buyerName?: string;
}

/** The lookup seam (spec §4.3: "given a transaction id, the Worker asks
 *  Paddle whether that transaction is real and paid"). Returns null for an
 *  id the merchant does not recognize. */
export interface MerchantLookup {
  transaction(id: string): Promise<MerchantTransaction | null>;
}

/**
 * A test double backed by a plain map, for tests/licence-worker.test.ts.
 * Never used from index.ts's real request handling.
 */
export class MapMerchantLookup implements MerchantLookup {
  private readonly rows: Map<string, MerchantTransaction>;

  constructor(rows: MerchantTransaction[] = []) {
    this.rows = new Map(rows.map((r) => [r.id, r]));
  }

  async transaction(id: string): Promise<MerchantTransaction | null> {
    return this.rows.get(id) ?? null;
  }

  set(row: MerchantTransaction): void {
    this.rows.set(row.id, row);
  }
}

/**
 * SECTION 9 OF THE SPEC: PADDLE-SPECIFIC, TO BE FILLED THE DAY PADDLE
 * APPROVES. This is a skeleton, not a working implementation. Before this is
 * ever deployed, confirm against Paddle's own documentation on that day:
 *
 *  - the exact API call and URL for reading a transaction back
 *  - the auth header shape for a read-only API key
 *  - the field names for the transaction id, paid/status, the product
 *    (founding vs standard), the purchase date, and the buyer's name
 *
 * Nothing here is load-bearing until that confirmation happens; this exists
 * so the route handler around it (index.ts) is real, tested code now, per
 * spec §11 step 2 ("deployed but wired to nothing").
 */
export class PaddleMerchantLookup implements MerchantLookup {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transaction(id: string): Promise<MerchantTransaction | null> {
    // TO BE CONFIRMED (spec §9): the real endpoint, and whether it is
    // "/transactions/{id}" or something else. The auth header shape below
    // (a bearer token) is Paddle's usual pattern but is not verified here.
    const res = await fetch(`https://api.paddle.com/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    // TO BE CONFIRMED (spec §9): every field name below is a placeholder
    // shape, not read from Paddle's documentation.
    const data = body.data as Record<string, unknown> | undefined;
    if (data === undefined) return null;
    const txnId = data.id;
    const status = data.status;
    const product = data.product;
    const date = data.billed_at ?? data.created_at;
    const buyerName = data.buyer_name;
    if (typeof txnId !== 'string') return null;
    if (product !== 'founding' && product !== 'standard') return null;
    if (typeof date !== 'string') return null;
    return {
      id: txnId,
      paid: status === 'completed' || status === 'paid',
      product,
      date: date.slice(0, 10),
      buyerName: typeof buyerName === 'string' ? buyerName : undefined,
    };
  }
}
