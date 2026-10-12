from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401  (register tables)
from app.config import get_settings
from app.db import Base

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata

# PostGIS/tiger tables created by extensions are not ours.
def include_object(obj, name, type_, reflected, compare_to):
    return not (type_ == "table" and reflected and compare_to is None)


def run_migrations_online() -> None:
    engine = engine_from_config(config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
