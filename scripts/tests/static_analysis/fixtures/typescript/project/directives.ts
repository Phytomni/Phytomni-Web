// @ts-expect-error used: the assignment below is intentionally invalid
const invalidValue: string = 1;

// @ts-expect-error unused: this line is already valid
const validValue = 1;

// @ts-ignore broad escape retained only as an inventory fixture
const ignoredValue: string = 1;

export { invalidValue, validValue, ignoredValue };
