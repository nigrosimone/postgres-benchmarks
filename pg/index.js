const pg = require("pg");

const db = new pg.Pool({ max: 4 });

module.exports = {
  queries: {
    select_where: () =>
      db.query({
        text: `select * from pg_catalog.pg_type where typname = $1`,
        values: ["bool"],
        name: "select_where",
      }),
  },
  end: () => db.end(),
};
