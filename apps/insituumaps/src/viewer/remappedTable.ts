/**
 * A table whose rows are a re-indexed view of another table, so that a label
 * mask whose labels are not the table's IDs (nuclei labelled by nucleus
 * index) can be coloured by the values of the cell each label belongs to.
 */
import type {
  IDArray,
  ProgressCallback,
  TableColumnQuerySuggestion,
  TableData,
  TypedArrayOrArray,
} from "@tissuumaps/core";

export class RemappedTableData implements TableData {
  private readonly _base: TableData;
  private readonly _ids: Uint32Array;
  private readonly _rows: Int32Array;
  private readonly _values = new Map<
    string,
    Promise<TypedArrayOrArray<unknown>>
  >();
  private _names: string[] | undefined;

  /**
   * @param base - The table holding the values
   * @param ids - The IDs (raster labels) of the rows of this table
   * @param rows - For each ID, the row of `base` it takes its values from
   */
  constructor(base: TableData, ids: Uint32Array, rows: Int32Array) {
    if (ids.length !== rows.length) {
      throw new Error("IDs and rows differ in length");
    }
    this._base = base;
    this._ids = ids;
    this._rows = rows;
  }

  /**
   * Builds the remapped table from a label-to-row lookup
   *
   * @param base - The table holding the values
   * @param labelToRow - For every label (index), the base row or -1
   */
  static fromLabelToRow(
    base: TableData,
    labelToRow: Int32Array,
  ): RemappedTableData {
    let count = 0;
    for (let label = 0; label < labelToRow.length; label++) {
      if (labelToRow[label]! >= 0) {
        count++;
      }
    }
    const ids = new Uint32Array(count);
    const rows = new Int32Array(count);
    let k = 0;
    for (let label = 0; label < labelToRow.length; label++) {
      const row = labelToRow[label]!;
      if (row >= 0) {
        ids[k] = label;
        rows[k] = row;
        k++;
      }
    }
    return new RemappedTableData(base, ids, rows);
  }

  getIds(): IDArray {
    return this._ids;
  }

  getSize(): number {
    return this._ids.length;
  }

  getNames(): string[] | undefined {
    if (this._names === undefined) {
      const baseNames = this._base.getNames?.();
      if (baseNames !== undefined) {
        this._names = Array.from(this._rows, (row) => baseNames[row] ?? "");
      }
    }
    return this._names;
  }

  suggestColumnQueries(
    currentQuery: string,
    options?: { signal?: AbortSignal },
  ): Promise<TableColumnQuerySuggestion[]> {
    return this._base.suggestColumnQueries(currentQuery, options);
  }

  resolveColumnQuery(
    query: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null> {
    return this._base.resolveColumnQuery(query, options);
  }

  loadValues<T>(
    column: string,
    options?: { signal?: AbortSignal; onProgress?: ProgressCallback },
  ): Promise<TypedArrayOrArray<T>> {
    let promise = this._values.get(column);
    if (promise === undefined) {
      promise = this._base
        .loadValues<unknown>(column, options)
        .then((values) => this._remap(values));
      promise.catch(() => this._values.delete(column));
      this._values.set(column, promise);
    }
    return promise as Promise<TypedArrayOrArray<T>>;
  }

  loadValueRange(
    column: string,
    options?: { signal?: AbortSignal; onProgress?: ProgressCallback },
  ): Promise<[number, number] | undefined> {
    if (this._base.loadValueRange !== undefined) {
      return this._base.loadValueRange(column, options);
    }
    return this.loadValues<unknown>(column, options).then((values) => {
      if (!ArrayBuffer.isView(values)) {
        return undefined;
      }
      let vmin = Infinity;
      let vmax = -Infinity;
      const numbers = values as ArrayLike<number>;
      for (let i = 0; i < numbers.length; i++) {
        const v = numbers[i]!;
        if (Number.isFinite(v)) {
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
      }
      return vmin < vmax ? [vmin, vmax] : undefined;
    });
  }

  close(): void {
    this._values.clear();
  }

  private _remap(
    values: TypedArrayOrArray<unknown>,
  ): TypedArrayOrArray<unknown> {
    const rows = this._rows;
    if (ArrayBuffer.isView(values)) {
      const typed = values as unknown as ArrayLike<number> & {
        constructor: new (length: number) => ArrayLike<number> & {
          [index: number]: number;
        };
      };
      const Ctor = typed.constructor;
      const result = new Ctor(rows.length);
      for (let i = 0; i < rows.length; i++) {
        result[i] = typed[rows[i]!]!;
      }
      return result as unknown as TypedArrayOrArray<unknown>;
    }
    const plain = values;
    return Array.from(rows, (row) => plain[row]);
  }
}
