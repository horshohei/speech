export type ZodIssue = {
  path: (string | number)[];
  message: string;
};

export class ZodError extends Error {
  issues: ZodIssue[];

  constructor(issues: ZodIssue[]) {
    super("Validation failed");
    this.issues = issues;
  }

  format() {
    return this.issues;
  }
}

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseFailure = { success: false; error: ZodError };

type SafeParseReturn<T> = SafeParseSuccess<T> | SafeParseFailure;

abstract class Schema<T> {
  abstract _parse(data: unknown, path: (string | number)[]): T;

  parse(data: unknown): T {
    const result = this.safeParse(data);
    if (!result.success) {
      throw result.error;
    }
    return result.data;
  }

  safeParse(data: unknown): SafeParseReturn<T> {
    try {
      const parsed = this._parse(data, []);
      return { success: true, data: parsed };
    } catch (error) {
      if (error instanceof ZodError) {
        return { success: false, error };
      }
      throw error;
    }
  }

  default(_value: T): Schema<T> {
    return new DefaultSchema(this, _value);
  }

  optional(): Schema<T | undefined> {
    return new OptionalSchema(this);
  }
}

class DefaultSchema<T> extends Schema<T> {
  constructor(private inner: Schema<T>, private defaultValue: T) {
    super();
  }

  _parse(data: unknown, path: (string | number)[]): T {
    if (data === undefined) {
      return this.defaultValue;
    }
    return this.inner._parse(data, path);
  }
}

class OptionalSchema<T> extends Schema<T | undefined> {
  constructor(private inner: Schema<T>) {
    super();
  }

  _parse(data: unknown, path: (string | number)[]): T | undefined {
    if (data === undefined) {
      return undefined;
    }
    return this.inner._parse(data, path);
  }
}

class StringSchema extends Schema<string> {
  private minLength?: number;
  private refinements: Array<{ predicate: (value: string) => boolean; message: string }> = [];
  private defaultValue?: string;

  constructor() {
    super();
    this.refinements = [];
  }

  _parse(data: unknown, path: (string | number)[]): string {
    if (data === undefined) {
      if (this.defaultValue !== undefined) {
        return this.defaultValue;
      }
      throw new ZodError([{ path, message: "Required" }]);
    }

    if (typeof data !== "string") {
      throw new ZodError([{ path, message: "Expected string" }]);
    }

    if (this.minLength !== undefined && data.length < this.minLength) {
      throw new ZodError([{ path, message: `Expected at least ${this.minLength} characters` }]);
    }

    for (const { predicate, message } of this.refinements) {
      if (!predicate(data)) {
        throw new ZodError([{ path, message }]);
      }
    }

    return data;
  }

  min(length: number): this {
    this.minLength = length;
    return this;
  }

  refine(predicate: (value: string) => boolean, message: string): this {
    this.refinements.push({ predicate, message });
    return this;
  }

  default(value: string): Schema<string> {
    this.defaultValue = value;
    return this;
  }
}

class NumberSchema extends Schema<number> {
  private requireInt = false;
  private minValue?: number;
  private maxValue?: number;

  _parse(data: unknown, path: (string | number)[]): number {
    if (data === undefined) {
      throw new ZodError([{ path, message: "Required" }]);
    }

    if (typeof data !== "number" || Number.isNaN(data)) {
      throw new ZodError([{ path, message: "Expected number" }]);
    }

    if (this.requireInt && !Number.isInteger(data)) {
      throw new ZodError([{ path, message: "Expected integer" }]);
    }

    if (this.minValue !== undefined && data < this.minValue) {
      throw new ZodError([{ path, message: `Expected number >= ${this.minValue}` }]);
    }

    if (this.maxValue !== undefined && data > this.maxValue) {
      throw new ZodError([{ path, message: `Expected number <= ${this.maxValue}` }]);
    }

    return data;
  }

  int(): this {
    this.requireInt = true;
    return this;
  }

  min(value: number): this {
    this.minValue = value;
    return this;
  }

  max(value: number): this {
    this.maxValue = value;
    return this;
  }
}

class ObjectSchema<T extends Record<string, unknown>> extends Schema<T> {
  constructor(private shape: { [K in keyof T]: Schema<T[K]> }) {
    super();
  }

  _parse(data: unknown, path: (string | number)[]): T {
    if (data === undefined || data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new ZodError([{ path, message: "Expected object" }]);
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key as keyof T];
      const value = (data as Record<string, unknown>)[key];
      try {
        result[key] = schema._parse(value, [...path, key]);
      } catch (error) {
        if (error instanceof ZodError) {
          throw error;
        }
        throw error;
      }
    }
    return result as T;
  }
}

export const z = {
  string(): Schema<string> {
    return new StringSchema();
  },
  number(): Schema<number> {
    return new NumberSchema();
  },
  object<T extends Record<string, unknown>>(shape: { [K in keyof T]: Schema<T[K]> }): Schema<T> {
    return new ObjectSchema<T>(shape);
  },
};
