"""Run with python3 tests/refresh-sql.py; exercises actual scheduler SQL on SQLite."""
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLAIM = re.search(r'`(UPDATE characters SET lease_token=.+?)`', (ROOT / 'src/server/refresh.ts').read_text(), re.S).group(1)

class RefreshClaimTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO squads(id,name,ruleset) VALUES('s','Squad','normal')")
    def character(self, identity, due, verified=1, referenced=True, status='idle'):
        self.db.execute('INSERT INTO characters(id,name,normalized_name,ruleset,verified,provider,external_id,next_due,sync_status) VALUES(?,?,?,?,?,?,?,?,?)', (identity,identity,identity,'normal',verified,'test',identity,due,status))
        if referenced:
            self.db.execute("INSERT INTO squad_characters VALUES('s',?)", (identity,))
    def claim(self, token, now=1000):
        return self.db.execute(CLAIM, (token,now+300,now,now,now,now)).fetchone()
    def test_claims_one_oldest_due_and_never_duplicates_lease(self):
        self.character('later',900)
        self.character('first',800)
        self.assertEqual(self.claim('a')[0], 'first')
        self.assertEqual(self.claim('b')[0], 'later')
        self.assertIsNone(self.claim('c'))
        self.assertEqual(self.claim('d',1300)[0], 'first')
    def test_excludes_placeholders_unreferenced_unsupported_future_and_backoff(self):
        self.character('placeholder',0,verified=0)
        self.character('orphan',0,referenced=False)
        self.character('unsupported',0,status='unsupported')
        self.character('future',2000)
        self.character('blocked',0)
        self.db.execute("INSERT INTO refresh_backoff VALUES('test',1500)")
        self.assertIsNone(self.claim('a'))
        self.assertEqual(self.claim('b',1500)[0], 'blocked')
    def test_expired_owner_cannot_overwrite_reclaimed_snapshot(self):
        self.character('first',0)
        self.claim('old')
        self.claim('new',1300)
        sql = "UPDATE characters SET profile_json=? WHERE id=? AND lease_token=? AND lease_until>?"
        self.db.execute(sql, ('{"old":true}','first','old',1300))
        self.assertEqual(self.db.execute("SELECT profile_json FROM characters WHERE id='first'").fetchone()[0], '{}')

if __name__ == '__main__':
    unittest.main()
