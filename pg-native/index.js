const pg = require('pg').native

const db = new pg.Pool({ max: 4 })

module.exports = {
  queries: {
    select: () => db.query('select 1 as x'),
    select_arg: () => db.query('select $1 as x', [1]),
    select_args: () => db.query(`select
      $1::int as int,
      $2 as string,
      $3 as null,
      $4::bool as boolean
    `, [
      1337,
      'wat',
      null,
      false
    ]),
    select_where: () => db.query(`select * from pg_catalog.pg_type where typname = $1`, ['bool'])
  },
  end: () => db.end()
}
