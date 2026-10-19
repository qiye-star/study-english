"""断开某用户的在线连接(实时通话与房间 WebSocket)。

非路由模块:只有函数,没有 APIRouter。管理端的用户治理路由与账号路由(改密、重置密码)都从这里导入,
用户路由不互相依赖(INDEX X30)。
"""
from app.realtime.realtime_protocol import CLOSE_UNAUTHORIZED
from app.rooms.protocol import CLOSE_KICKED


async def cut_connections(app, user_id: int) -> None:
    """Revoke unredeemed tickets, end a live realtime call (4001) and close the user's live room sockets with 4010."""
    app.state.realtime_tickets.revoke_user(user_id)
    await app.state.realtime_registry.end_user(user_id, CLOSE_UNAUTHORIZED)
    rt = getattr(app.state, "rooms", None)
    if rt is None:
        return
    rt.tickets.revoke_user(user_id)
    for room_id in rt.hub.active_rooms():
        if user_id in rt.hub.online(room_id):
            await rt.hub.close_user(room_id, user_id, CLOSE_KICKED)
