"""Prisma client singleton (house pattern, same as the other Miya backends).

The app boots even when Postgres is unreachable so /health and /docs still serve;
routers can check ``prisma.is_connected()`` before hitting the DB.
"""

from prisma import Prisma

prisma = Prisma(auto_register=True)


async def connect_db() -> None:
    if not prisma.is_connected():
        await prisma.connect()


async def disconnect_db() -> None:
    if prisma.is_connected():
        await prisma.disconnect()
