CREATE TRIGGER users_admin_name_insert BEFORE INSERT ON users WHEN (NEW.role='admin' AND NEW.username!='admin') OR (NEW.username='admin' AND NEW.role!='admin') BEGIN SELECT RAISE(ABORT, 'The admin account must be named admin'); END;

CREATE TRIGGER users_admin_name_update BEFORE UPDATE OF username,role ON users WHEN (NEW.role='admin' AND NEW.username!='admin') OR (NEW.username='admin' AND NEW.role!='admin') BEGIN SELECT RAISE(ABORT, 'The admin account must be named admin'); END;
