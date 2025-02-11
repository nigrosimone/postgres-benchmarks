const postgres = require('postgres')

const sql = postgres({ max: 4 })

module.exports = {
  queries: {
    select_where: () => sql`select * from pg_catalog.pg_type where typname = ${ 'bool' }`
  },
  end: () => sql.end({ timeout: 0 })
}

/*
insert: () => sql`insert into test(string, number, date) values (${ 'Hello' }, ${ 42 }, ${ new Date() })`,
    select: () => sql`select * from test where string = ${ 'Hello' } and number = ${ 42 }`,
    update: () => sql`update test set string = ${ 'world' }, number = ${ 15 }, date = ${ new Date() }`,
    delete: () => sql`delete from test where string = ${ 'world' } and number = ${ 15 }`
    */
