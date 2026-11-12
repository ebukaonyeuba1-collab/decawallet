import { migrateRemote } from "../src/lib/db";

migrateRemote()
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
