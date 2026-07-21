/* eslint-disable no-console */
console.log("fixture");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payload: any = {};
console.log(payload); // eslint-disable-line no-console
// @ts-expect-error fixture intentionally checks a narrow boundary
const expected: string = payload;
// @ts-ignore fixture intentionally checks a legacy boundary
const ignored: string = payload;
// @ts-nocheck
// prettier-ignore
const formatted = { value: payload };
// This text documents eslint-disable-next-line no-console and is not a live directive.
const description = "eslint-disable-next-line no-console";
