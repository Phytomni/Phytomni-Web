interface User {
  name: string;
}

const unused: User = { name: "fixture" };
console.log(unused);

/* eslint-disable no-alert */
const alertValue = "fixture";
/* eslint-enable no-alert */
