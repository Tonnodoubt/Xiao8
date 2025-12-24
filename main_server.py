# -*- coding: utf-8 -*-
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Windows multiprocessing 支持：确保子进程不会重复执行模块级初始化
from multiprocessing import freeze_support
freeze_support()

# 检查是否需要执行初始化（用于防止 Windows spawn 方式创建的子进程重复初始化）
# 方案：首次导入时设置环境变量标记，子进程会继承这个标记从而跳过初始化
_INIT_MARKER = '_NEKO_MAIN_SERVER_INITIALIZED'
_IS_MAIN_PROCESS = _INIT_MARKER not in os.environ

if _IS_MAIN_PROCESS:
    # 立即设置标记，这样任何从此进程 spawn 的子进程都会继承此标记
    os.environ[_INIT_MARKER] = '1'

# 获取应用程序根目录（与 config_manager 保持一致）
def _get_app_root():
    if getattr(sys, 'frozen', False):
        if hasattr(sys, '_MEIPASS'):
            return sys._MEIPASS
        else:
            return os.path.dirname(sys.executable)
    else:
        return os.getcwd()

# Only adjust DLL search path on Windows
if sys.platform == "win32" and hasattr(os, "add_dll_directory"):
    os.add_dll_directory(_get_app_root())
    
import mimetypes # noqa
mimetypes.add_type("application/javascript", ".js")
import asyncio # noqa
import logging # noqa
import json # noqa
import uuid # noqa
import webbrowser # noqa
from datetime import datetime # noqa
from urllib.parse import quote # noqa
import io # noqa
import pathlib # noqa
import wave # noqa
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, File, UploadFile, Form, Body # noqa
from fastapi.responses import HTMLResponse, JSONResponse # noqa
from fastapi.staticfiles import StaticFiles # noqa
from main_logic import core as core, cross_server as cross_server # noqa
from fastapi.templating import Jinja2Templates # noqa
from threading import Thread, Event as ThreadEvent # noqa
from queue import Queue # noqa
import atexit # noqa
import httpx # noqa
from config import MAIN_SERVER_PORT, MONITOR_SERVER_PORT # noqa
from utils.config_manager import get_config_manager # noqa
# 导入创意工坊工具模块
from utils.workshop_utils import ( # noqa
    get_workshop_root,
    get_workshop_path
)
# 导入创意工坊路由中的函数
from main_routers.workshop_router import get_subscribed_workshop_items # noqa

# 确定 templates 目录位置（使用 _get_app_root）
template_dir = _get_app_root()

templates = Jinja2Templates(directory=template_dir)

def initialize_steamworks():
    try:
        # 明确读取steam_appid.txt文件以获取应用ID
        app_id = None
        app_id_file = os.path.join(_get_app_root(), 'steam_appid.txt')
        if os.path.exists(app_id_file):
            with open(app_id_file, 'r') as f:
                app_id = f.read().strip()
            print(f"从steam_appid.txt读取到应用ID: {app_id}")
        
        # 创建并初始化Steamworks实例
        from steamworks import STEAMWORKS
        steamworks = STEAMWORKS()
        # 显示Steamworks初始化过程的详细日志
        print("正在初始化Steamworks...")
        steamworks.initialize()
        steamworks.UserStats.RequestCurrentStats()
        # 初始化后再次获取应用ID以确认
        actual_app_id = steamworks.app_id
        print(f"Steamworks初始化完成，实际使用的应用ID: {actual_app_id}")
        
        # 检查全局logger是否已初始化，如果已初始化则记录成功信息
        if 'logger' in globals():
            logger.info(f"Steamworks初始化成功，应用ID: {actual_app_id}")
            logger.info(f"Steam客户端运行状态: {steamworks.IsSteamRunning()}")
            logger.info(f"Steam覆盖层启用状态: {steamworks.IsOverlayEnabled()}")
        
        return steamworks
    except Exception as e:
        # 检查全局logger是否已初始化，如果已初始化则记录错误，否则使用print
        error_msg = f"初始化Steamworks失败: {e}"
        if 'logger' in globals():
            logger.error(error_msg)
        else:
            print(error_msg)
        return None

def get_default_steam_info():
    global steamworks
    # 检查steamworks是否初始化成功
    if steamworks is None:
        print("Steamworks not initialized. Skipping Steam functionality.")
        if 'logger' in globals():
            logger.info("Steamworks not initialized. Skipping Steam functionality.")
        return
    
    try:
        my_steam64 = steamworks.Users.GetSteamID()
        my_steam_level = steamworks.Users.GetPlayerSteamLevel()
        subscribed_apps = steamworks.Workshop.GetNumSubscribedItems()
        print(f'Subscribed apps: {subscribed_apps}')

        print(f'Logged on as {my_steam64}, level: {my_steam_level}')
        print('Is subscribed to current app?', steamworks.Apps.IsSubscribed())
    except Exception as e:
        print(f"Error accessing Steamworks API: {e}")
        if 'logger' in globals():
            logger.error(f"Error accessing Steamworks API: {e}")

# Steamworks 初始化将在 @app.on_event("startup") 中延迟执行
# 这样可以避免在模块导入时就执行 DLL 加载等操作
steamworks = None

# Configure logging (子进程静默初始化，避免重复打印初始化消息)
from utils.logger_config import setup_logging # noqa: E402

logger, log_config = setup_logging(service_name="Main", log_level=logging.INFO, silent=not _IS_MAIN_PROCESS)

_config_manager = get_config_manager()

def cleanup():
    logger.info("Starting cleanup process")
    for k in sync_message_queue:
        # 清空队列（queue.Queue 没有 close/join_thread 方法）
        try:
            while sync_message_queue[k] and not sync_message_queue[k].empty():
                sync_message_queue[k].get_nowait()
        except: # noqa: E722
            pass
    logger.info("Cleanup completed")

# 只在主进程中注册 cleanup 函数，防止子进程退出时执行清理
if _IS_MAIN_PROCESS:
    atexit.register(cleanup)

sync_message_queue = {}
sync_shutdown_event = {}
session_manager = {}
session_id = {}
sync_process = {}
# 每个角色的websocket操作锁，用于防止preserve/restore与cleanup()之间的竞争
websocket_locks = {}
# Global variables for character data (will be updated on reload)
master_name = None
her_name = None
master_basic_config = None
lanlan_basic_config = None
name_mapping = None
lanlan_prompt = None
semantic_store = None
time_store = None
setting_store = None
recent_log = None
catgirl_names = []

async def initialize_character_data():
    """初始化或重新加载角色配置数据"""
    global master_name, her_name, master_basic_config, lanlan_basic_config
    global name_mapping, lanlan_prompt, semantic_store, time_store, setting_store, recent_log
    global catgirl_names, sync_message_queue, sync_shutdown_event, session_manager, session_id, sync_process, websocket_locks
    
    logger.info("正在加载角色配置...")
    
    # 清理无效的voice_id引用
    _config_manager.cleanup_invalid_voice_ids()
    
    # 加载最新的角色数据
    master_name, her_name, master_basic_config, lanlan_basic_config, name_mapping, lanlan_prompt, semantic_store, time_store, setting_store, recent_log = _config_manager.get_character_data()
    catgirl_names = list(lanlan_prompt.keys())
    
    # 为新增的角色初始化资源
    for k in catgirl_names:
        is_new_character = False
        if k not in sync_message_queue:
            sync_message_queue[k] = Queue()
            sync_shutdown_event[k] = ThreadEvent()
            session_id[k] = None
            sync_process[k] = None
            logger.info(f"为角色 {k} 初始化新资源")
            is_new_character = True
        
        # 确保该角色有websocket锁
        if k not in websocket_locks:
            websocket_locks[k] = asyncio.Lock()
        
        # 更新或创建session manager（使用最新的prompt）
        # 使用锁保护websocket的preserve/restore操作，防止与cleanup()竞争
        async with websocket_locks[k]:
            # 如果已存在且已有websocket连接，保留websocket引用
            old_websocket = None
            if k in session_manager and session_manager[k].websocket:
                old_websocket = session_manager[k].websocket
                logger.info(f"保留 {k} 的现有WebSocket连接")
            
            # 注意：不在这里清理旧session，因为：
            # 1. 切换当前角色音色时，已在API层面关闭了session
            # 2. 切换其他角色音色时，已跳过重新加载
            # 3. 其他场景不应该影响正在使用的session
            # 如果旧session_manager有活跃session，保留它，只更新配置相关的字段
            
            # 先检查会话状态（在锁内检查避免竞态条件）
            has_active_session = k in session_manager and session_manager[k].is_active
            
            if has_active_session:
                # 有活跃session，不重新创建session_manager，只更新配置
                # 这是为了防止重新创建session_manager时破坏正在运行的session
                try:
                    old_mgr = session_manager[k]
                    # 更新prompt
                    old_mgr.lanlan_prompt = lanlan_prompt[k].replace('{LANLAN_NAME}', k).replace('{MASTER_NAME}', master_name)
                    # 重新读取角色配置以更新voice_id等字段
                    (
                        _,
                        _,
                        _,
                        lanlan_basic_config_updated,
                        _,
                        _,
                        _,
                        _,
                        _,
                        _
                    ) = _config_manager.get_character_data()
                    # 更新voice_id（这是切换音色时需要的）
                    old_mgr.voice_id = lanlan_basic_config_updated[k].get('voice_id', '')
                    logger.info(f"{k} 有活跃session，只更新配置，不重新创建session_manager")
                except Exception as e:
                    logger.error(f"更新 {k} 的活跃session配置失败: {e}", exc_info=True)
                    # 配置更新失败，但为了不影响正在运行的session，继续使用旧配置
                    # 如果确实需要更新配置，可以考虑在下次session重启时再应用
            else:
                # 没有活跃session，可以安全地重新创建session_manager
                session_manager[k] = core.LLMSessionManager(
                    sync_message_queue[k],
                    k,
                    lanlan_prompt[k].replace('{LANLAN_NAME}', k).replace('{MASTER_NAME}', master_name)
                )
                
                # 将websocket锁存储到session manager中，供cleanup()使用
                session_manager[k].websocket_lock = websocket_locks[k]
                
                # 恢复websocket引用（如果存在）
                if old_websocket:
                    session_manager[k].websocket = old_websocket
                    logger.info(f"已恢复 {k} 的WebSocket连接")
        
        # 检查并启动同步连接器线程
        # 如果是新角色，或者线程不存在/已停止，需要启动线程
        if k not in sync_process:
            sync_process[k] = None
        
        need_start_thread = False
        if is_new_character:
            # 新角色，需要启动线程
            need_start_thread = True
        elif sync_process[k] is None:
            # 线程为None，需要启动
            need_start_thread = True
        elif hasattr(sync_process[k], 'is_alive') and not sync_process[k].is_alive():
            # 线程已停止，需要重启
            need_start_thread = True
            try:
                sync_process[k].join(timeout=0.1)
            except: # noqa: E722
                pass
        
        if need_start_thread:
            try:
                sync_process[k] = Thread(
                    target=cross_server.sync_connector_process,
                    args=(sync_message_queue[k], sync_shutdown_event[k], k, f"ws://localhost:{MONITOR_SERVER_PORT}", {'bullet': False, 'monitor': True}),
                    daemon=True,
                    name=f"SyncConnector-{k}"
                )
                sync_process[k].start()
                logger.info(f"✅ 已为角色 {k} 启动同步连接器线程 ({sync_process[k].name})")
                await asyncio.sleep(0.1)  # 线程启动更快，减少等待时间
                if not sync_process[k].is_alive():
                    logger.error(f"❌ 同步连接器线程 {k} ({sync_process[k].name}) 启动后立即退出！")
                else:
                    logger.info(f"✅ 同步连接器线程 {k} ({sync_process[k].name}) 正在运行")
            except Exception as e:
                logger.error(f"❌ 启动角色 {k} 的同步连接器线程失败: {e}", exc_info=True)
    
    # 清理已删除角色的资源
    removed_names = [k for k in session_manager.keys() if k not in catgirl_names]
    for k in removed_names:
        logger.info(f"清理已删除角色 {k} 的资源")
        
        # 先停止同步连接器线程（线程只能协作式终止，不能强制kill）
        if k in sync_process and sync_process[k] is not None:
            try:
                logger.info(f"正在停止已删除角色 {k} 的同步连接器线程...")
                if k in sync_shutdown_event:
                    sync_shutdown_event[k].set()
                sync_process[k].join(timeout=3)  # 等待线程正常结束
                if sync_process[k].is_alive():
                    logger.warning(f"⚠️ 同步连接器线程 {k} 未能在超时内停止，将作为daemon线程自动清理")
                else:
                    logger.info(f"✅ 已停止角色 {k} 的同步连接器线程")
            except Exception as e:
                logger.warning(f"停止角色 {k} 的同步连接器线程时出错: {e}")
        
        # 清理队列（queue.Queue 没有 close/join_thread 方法）
        if k in sync_message_queue:
            try:
                while not sync_message_queue[k].empty():
                    sync_message_queue[k].get_nowait()
            except: # noqa
                pass
            del sync_message_queue[k]
        
        # 清理其他资源
        if k in sync_shutdown_event:
            del sync_shutdown_event[k]
        if k in session_manager:
            del session_manager[k]
        if k in session_id:
            del session_id[k]
        if k in sync_process:
            del sync_process[k]
    
    logger.info(f"角色配置加载完成，当前角色: {catgirl_names}，主人: {master_name}")

# 初始化角色数据（使用asyncio.run在模块级别执行async函数）
# 只在主进程中执行，防止 Windows 上子进程重复导入时再次启动子进程
if _IS_MAIN_PROCESS:
    import asyncio as _init_asyncio
    try:
        _init_asyncio.get_event_loop()
    except RuntimeError:
        _init_asyncio.set_event_loop(_init_asyncio.new_event_loop())
    _init_asyncio.get_event_loop().run_until_complete(initialize_character_data())
lock = asyncio.Lock()

# --- FastAPI App Setup ---
app = FastAPI()



class CustomStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.endswith('.js'):
            response.headers['Content-Type'] = 'application/javascript'
        return response

# 确定 static 目录位置（使用 _get_app_root）
static_dir = os.path.join(_get_app_root(), 'static')

app.mount("/static", CustomStaticFiles(directory=static_dir), name="static")

# 挂载用户文档下的live2d目录（只在主进程中执行，子进程不提供HTTP服务）
if _IS_MAIN_PROCESS:
    _config_manager.ensure_live2d_directory()
    _config_manager.ensure_chara_directory()
    user_live2d_path = str(_config_manager.live2d_dir)
    if os.path.exists(user_live2d_path):
        app.mount("/user_live2d", CustomStaticFiles(directory=user_live2d_path), name="user_live2d")
        logger.info(f"已挂载用户Live2D目录: {user_live2d_path}")

    # 挂载用户mod路径
    user_mod_path = _config_manager.get_workshop_path()
    if os.path.exists(user_mod_path) and os.path.isdir(user_mod_path):
        app.mount("/user_mods", CustomStaticFiles(directory=user_mod_path), name="user_mods")
        logger.info(f"已挂载用户mod路径: {user_mod_path}")

# --- Initialize Shared State and Mount Routers ---
# Import and mount routers from main_routers package
from main_routers import ( # noqa
    config_router,
    characters_router,
    live2d_router,
    workshop_router,
    memory_router,
    pages_router,
    websocket_router,
    agent_router,
    system_router,
)
from main_routers.shared_state import init_shared_state # noqa

# Initialize shared state for routers to access
# 注意：steamworks 会在 startup 事件中初始化后更新
if _IS_MAIN_PROCESS:
    init_shared_state(
        sync_message_queue=sync_message_queue,
        sync_shutdown_event=sync_shutdown_event,
        session_manager=session_manager,
        session_id=session_id,
        sync_process=sync_process,
        websocket_locks=websocket_locks,
        steamworks=None,  # 延迟初始化，会在 startup 事件中设置
        templates=templates,
        config_manager=_config_manager,
        logger=logger,
        initialize_character_data=initialize_character_data,
    )

@app.post('/api/beacon/shutdown')
async def beacon_shutdown(request: Request):
    """Beacon API for graceful server shutdown"""
    try:
        # 获取请求数据
        data = await request.json()
        page = data.get('page', '')
        
        # 从 app.state 获取配置
        current_config = get_start_config()
        # Only respond to beacon if server was started with --open-browser
        # 并且只有来自主页（index.html）的beacon信号才关闭服务器
        if current_config['browser_mode_enabled'] and page == 'index':
            logger.info("收到来自主页的beacon信号，准备关闭服务器...")
            # Schedule server shutdown
            asyncio.create_task(shutdown_server_async())
            return {"success": True, "message": "服务器关闭信号已接收"}
        elif current_config['browser_mode_enabled']:
            # 来自其他页面的beacon信号，只记录日志，不关闭服务器
            logger.info(f"收到beacon信号（来自页面: {page or '未知'}），但不关闭服务器")
            return {"success": True, "message": "Beacon信号已接收，但不会关闭服务器"}
    except Exception as e:
        logger.error(f"Beacon处理错误: {e}")
        return {"success": False, "error": str(e)}

# Mount all routers
app.include_router(config_router)
app.include_router(characters_router)
app.include_router(live2d_router)
app.include_router(workshop_router)
app.include_router(memory_router)
# Note: pages_router should be mounted last due to catch-all route /{lanlan_name}
app.include_router(websocket_router)
app.include_router(agent_router)
app.include_router(system_router)
app.include_router(pages_router)  # Mount last for catch-all routes

# 后台预加载任务
_preload_task: asyncio.Task = None


async def _background_preload():
    """后台预加载音频处理模块
    
    注意：不需要 Event 同步机制，因为 Python 的 import lock 会自动等待首次导入完成。
    如果用户在预加载完成前点击语音，再次 import 会自动阻塞等待。
    """
    try:
        logger.info("🔄 后台预加载音频处理模块...")
        # 在线程池中执行同步导入（避免阻塞事件循环）
        import concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            await loop.run_in_executor(pool, _sync_preload_modules)
    except Exception as e:
        logger.warning(f"⚠️ 音频处理模块预加载失败（不影响使用）: {e}")


def _sync_preload_modules():
    """同步预加载延迟导入的模块（在线程池中执行）
    
    注意：以下模块已通过导入链在启动时加载，无需预加载：
    - numpy, soxr: 通过 core.py / audio_processor.py
    - websockets: 通过 omni_realtime_client.py
    - langchain_openai/langchain_core: 通过 omni_offline_client.py
    - httpx: 通过 core.py
    - aiohttp: 通过 tts_client.py
    
    真正需要预加载的延迟导入模块：
    - pyrnnoise/audiolab: audio_processor.py 中通过 _get_rnnoise() 延迟加载
    - dashscope: tts_client.py 中仅在 cosyvoice_vc_tts_worker 函数内部导入
    - googletrans/translatepy: language_utils.py 中延迟导入的翻译库
    - translation_service: main_logic/core.py 中延迟初始化的翻译服务
    """
    import time
    start = time.time()
    
    # 1. 翻译服务相关模块（避免首轮对话延迟）
    try:
        # 预加载翻译库（googletrans, translatepy 等）
        from utils import language_utils
        # 触发翻译库的导入（如果可用）
        _ = language_utils.GOOGLETRANS_AVAILABLE
        _ = language_utils.TRANSLATEPY_AVAILABLE
        logger.debug("✅ 翻译库预加载完成")
    except Exception as e:
        logger.debug(f"⚠️ 翻译库预加载失败（不影响使用）: {e}")
    
    # 2. 翻译服务实例（需要 config_manager）
    try:
        from utils.translation_service import get_translation_service
        from utils.config_manager import get_config_manager
        config_manager = get_config_manager()
        # 预初始化翻译服务实例（触发 LLM 客户端创建等）
        _ = get_translation_service(config_manager)
        logger.debug("✅ 翻译服务预加载完成")
    except Exception as e:
        logger.debug(f"⚠️ 翻译服务预加载失败（不影响使用）: {e}")
    
    # 3. pyrnnoise/audiolab (音频降噪 - 延迟加载，可能较慢)
    try:
        from utils.audio_processor import _get_rnnoise
        RNNoise = _get_rnnoise()
        if RNNoise:
            # 创建临时实例以预热神经网络权重加载
            _warmup_instance = RNNoise(sample_rate=48000)
            del _warmup_instance
            logger.debug("  ✓ pyrnnoise loaded and warmed up")
        else:
            logger.debug("  ✗ pyrnnoise not available")
    except Exception as e:
        logger.debug(f"  ✗ pyrnnoise: {e}")
    
    # 4. dashscope (阿里云 CosyVoice TTS SDK - 仅在使用自定义音色时需要)
    try:
        import dashscope  # noqa: F401
        logger.debug("  ✓ dashscope loaded")
    except Exception as e:
        logger.debug(f"  ✗ dashscope: {e}")
    
    # 5. AudioProcessor 预热（numpy buffer + soxr resampler 初始化）
    try:
        from utils.audio_processor import AudioProcessor
        import numpy as np
        # 创建临时实例预热 numpy/soxr
        _warmup_processor = AudioProcessor(
            input_sample_rate=48000,
            output_sample_rate=16000,
            noise_reduce_enabled=False  # 不需要 RNNoise，前面已预热
        )
        # 模拟处理一小块音频，预热 numpy 和 soxr 的 JIT
        _dummy_audio = np.zeros(480, dtype=np.int16).tobytes()
        _ = _warmup_processor.process_chunk(_dummy_audio)
        del _warmup_processor, _dummy_audio
        logger.debug("  ✓ AudioProcessor warmed up")
    except Exception as e:
        logger.debug(f"  ✗ AudioProcessor warmup: {e}")
    
    # 6. httpx SSL 上下文预热（首次创建 AsyncClient 会初始化 SSL）
    try:
        import httpx
        import asyncio
        
        async def _warmup_httpx():
            async with httpx.AsyncClient(timeout=1.0) as client:
                # 发送一个简单请求预热 SSL 上下文
                try:
                    await client.get("http://127.0.0.1:1", timeout=0.01)
                except:  # noqa: E722
                    pass  # 预期会失败，只是为了初始化 SSL
        
        # 在当前线程的事件循环中运行（如果没有则创建临时循环）
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 如果已有运行中的循环，使用线程池
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    pool.submit(lambda: asyncio.run(_warmup_httpx())).result(timeout=2.0)
            else:
                loop.run_until_complete(_warmup_httpx())
        except RuntimeError:
            asyncio.run(_warmup_httpx())
        logger.debug("  ✓ httpx SSL context warmed up")
    except Exception as e:
        logger.debug(f"  ✗ httpx warmup: {e}")
    
    elapsed = time.time() - start
    logger.info(f"📦 模块预加载完成，耗时 {elapsed:.2f}s")


# Startup 事件：延迟初始化 Steamworks 和全局语言
@app.on_event("startup")
async def on_startup():
    """服务器启动时执行的初始化操作"""
    if _IS_MAIN_PROCESS:
        global steamworks, _preload_task
        logger.info("正在初始化 Steamworks...")
        steamworks = initialize_steamworks()
        
        # 更新 shared_state 中的 steamworks 引用
        from main_routers.shared_state import set_steamworks
        set_steamworks(steamworks)
        
        # 尝试获取 Steam 信息
        get_default_steam_info()
        
        # 在后台异步预加载音频模块（不阻塞服务器启动）
        # 注意：不需要等待机制，Python import lock 会自动处理并发
        _preload_task = asyncio.create_task(_background_preload())
        await _init_and_mount_workshop()
        logger.info("Startup 初始化完成，后台正在预加载音频模块...")

        # 初始化全局语言变量（优先级：Steam设置 > 系统设置）
        try:
            from utils.language_utils import initialize_global_language
            global_lang = initialize_global_language()
            logger.info(f"全局语言初始化完成: {global_lang}")
        except Exception as e:
            logger.warning(f"全局语言初始化失败: {e}，将使用默认值")

# 使用 FastAPI 的 app.state 来管理启动配置
def get_start_config():
    """从 app.state 获取启动配置"""
    if hasattr(app.state, 'start_config'):
        return app.state.start_config
    return {
        "browser_mode_enabled": False,
        "browser_page": "chara_manager",
        'server': None
    }

def set_start_config(config):
    """设置启动配置到 app.state"""
    app.state.start_config = config

@app.get("/", response_class=HTMLResponse)
async def get_default_index(request: Request):
    return templates.TemplateResponse("templates/index.html", {
        "request": request
    })


@app.get("/api/preferences")
async def get_preferences():
    """获取用户偏好设置"""
    preferences = load_user_preferences()
    return preferences

@app.post("/api/preferences")
async def save_preferences(request: Request):
    """保存用户偏好设置"""
    try:
        data = await request.json()
        if not data:
            return {"success": False, "error": "无效的数据"}
        
        # 验证偏好数据
        if not validate_model_preferences(data):
            return {"success": False, "error": "偏好数据格式无效"}
        
        # 获取参数（可选）
        parameters = data.get('parameters')
        
        # 更新偏好
        if update_model_preferences(data['model_path'], data['position'], data['scale'], parameters):
            return {"success": True, "message": "偏好设置已保存"}
        else:
            return {"success": False, "error": "保存失败"}
            
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/steam_language")
async def get_steam_language():
    """获取 Steam 客户端的语言设置，用于前端 i18n 初始化"""
    global steamworks
    
    # Steam 语言代码到 i18n 语言代码的映射
    # 参考: https://partner.steamgames.com/doc/store/localization/languages
    STEAM_TO_I18N_MAP = {
        'schinese': 'zh-CN',      # 简体中文
        'tchinese': 'zh-CN',      # 繁体中文（映射到简体中文，因为目前只支持 zh-CN）
        'english': 'en',          # 英文
        # 其他语言默认映射到英文
    }
    
    try:
        if steamworks is None:
            return {
                "success": False,
                "error": "Steamworks 未初始化",
                "steam_language": None,
                "i18n_language": None
            }
        
        # 获取 Steam 当前游戏语言
        steam_language = steamworks.Apps.GetCurrentGameLanguage()
        # Steam API 可能返回 bytes，需要解码为字符串
        if isinstance(steam_language, bytes):
            steam_language = steam_language.decode('utf-8')
        
        # 映射到 i18n 语言代码
        i18n_language = STEAM_TO_I18N_MAP.get(steam_language, 'en')  # 默认英文
        logger.info(f"[i18n] Steam 语言映射: '{steam_language}' -> '{i18n_language}'")
        
        return {
            "success": True,
            "steam_language": steam_language,
            "i18n_language": i18n_language
        }
        
    except Exception as e:
        logger.error(f"获取 Steam 语言设置失败: {e}")
        return {
            "success": False,
            "error": str(e),
            "steam_language": None,
            "i18n_language": None
        }


@app.get("/api/live2d/models")
async def get_live2d_models(simple: bool = False):
    """
    获取Live2D模型列表
    Args:
        simple: 如果为True，只返回模型名称列表；如果为False，返回完整的模型信息
    """
    try:
        # 先获取本地模型
        models = find_models()
        
        # 再获取Steam创意工坊模型
        try:
            workshop_items_result = await get_subscribed_workshop_items()
            
            # 处理响应结果
            if isinstance(workshop_items_result, dict) and workshop_items_result.get('success', False):
                items = workshop_items_result.get('items', [])
                logger.info(f"获取到{len(items)}个订阅的创意工坊物品")
                
                # 遍历所有物品，提取已安装的模型
                for item in items:
                    # 直接使用get_subscribed_workshop_items返回的installedFolder
                    installed_folder = item.get('installedFolder')
                    # 从publishedFileId字段获取物品ID，而不是item_id
                    item_id = item.get('publishedFileId')
                    
                    if installed_folder and os.path.exists(installed_folder) and os.path.isdir(installed_folder) and item_id:
                        # 检查安装目录下是否有.model3.json文件
                        for filename in os.listdir(installed_folder):
                            if filename.endswith('.model3.json'):
                                model_name = os.path.splitext(os.path.splitext(filename)[0])[0]
                                
                                # 避免重复添加
                                if model_name not in [m['name'] for m in models]:
                                    # 构建正确的/workshop URL路径，确保没有多余的引号
                                    path_value = f'/workshop/{item_id}/{filename}'
                                    logger.debug(f"添加模型路径: {path_value!r}, item_id类型: {type(item_id)}, filename类型: {type(filename)}")
                                    # 移除可能的额外引号
                                    path_value = path_value.strip('"')
                                    models.append({
                                        'name': model_name,
                                        'path': path_value,
                                        'source': 'steam_workshop',
                                        'item_id': item_id
                                    })
                            
                        # 检查安装目录下的子目录
                        for subdir in os.listdir(installed_folder):
                            subdir_path = os.path.join(installed_folder, subdir)
                            if os.path.isdir(subdir_path):
                                model_name = subdir
                                json_file = os.path.join(subdir_path, f'{model_name}.model3.json')
                                if os.path.exists(json_file):
                                    # 避免重复添加
                                    if model_name not in [m['name'] for m in models]:
                                        # 构建正确的/workshop URL路径，确保没有多余的引号
                                        path_value = f'/workshop/{item_id}/{model_name}/{model_name}.model3.json'
                                        logger.debug(f"添加子目录模型路径: {path_value!r}, item_id类型: {type(item_id)}, model_name类型: {type(model_name)}")
                                        # 移除可能的额外引号
                                        path_value = path_value.strip('"')
                                        models.append({
                                            'name': model_name,
                                            'path': path_value,
                                            'source': 'steam_workshop',
                                            'item_id': item_id
                                        })
        except Exception as e:
            logger.error(f"获取创意工坊模型时出错: {e}")
        
        if simple:
            # 只返回模型名称列表
            model_names = [model["name"] for model in models]
            return {"success": True, "models": model_names}
        else:
            # 返回完整的模型信息（保持向后兼容）
            return models
    except Exception as e:
        logger.error(f"获取Live2D模型列表失败: {e}")
        if simple:
            return {"success": False, "error": str(e)}
        else:
            return []


@app.get("/api/models")
async def get_models_legacy():
    """
    向后兼容的API端点，重定向到新的 /api/live2d/models
    """
    return await get_live2d_models(simple=False)

@app.get("/api/vrm/models")
async def get_vrm_models(simple: bool = False):
    """
    获取VRM模型列表
    Args:
        simple: 如果为True，只返回模型名称列表；如果为False，返回完整的模型信息
    """
    try:
        from utils.frontend_utils import find_vrm_models
        models = find_vrm_models()
        
        if simple:
            # 只返回模型名称列表
            model_names = [model["name"] for model in models]
            return {"success": True, "models": model_names}
        else:
            # 返回完整的模型信息
            return models
    except Exception as e:
        logger.error(f"获取VRM模型列表失败: {e}")
        if simple:
            return {"success": False, "error": str(e)}
        else:
            return []

@app.get("/api/vrm/animations")
async def get_vrm_animations():
    """
    获取VRMA动画文件列表
    """
    try:
        from utils.frontend_utils import find_vrma_animations
        animations = find_vrma_animations()
        return {"success": True, "animations": animations}
    except Exception as e:
        logger.error(f"获取VRMA动画列表失败: {e}")
        return {"success": False, "error": str(e), "animations": []}

@app.post("/api/preferences/set-preferred")
async def set_preferred_model(request: Request):
    """设置首选模型"""
    try:
        data = await request.json()
        if not data or 'model_path' not in data:
            return {"success": False, "error": "无效的数据"}
        
        if move_model_to_top(data['model_path']):
            return {"success": True, "message": "首选模型已更新"}
        else:
            return {"success": False, "error": "模型不存在或更新失败"}
            
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/config/page_config")
async def get_page_config(lanlan_name: str = ""):
    """获取页面配置（lanlan_name 和 model_path）"""
    try:
        # 获取角色数据
        _, her_name, _, lanlan_basic_config, _, _, _, _, _, _ = _config_manager.get_character_data()
        
        # 如果提供了 lanlan_name 参数，使用它；否则使用当前角色
        target_name = lanlan_name if lanlan_name else her_name
        
        # 获取 live2d 和 live2d_item_id 字段
        live2d = lanlan_basic_config.get(target_name, {}).get('live2d', 'mao_pro')
        live2d_item_id = lanlan_basic_config.get(target_name, {}).get('live2d_item_id', '')
        
        logger.debug(f"获取页面配置 - 角色: {target_name}, 模型: {live2d}, item_id: {live2d_item_id}")
        
        # 使用 get_current_live2d_model 函数获取正确的模型信息
        # 第一个参数是角色名称，第二个参数是item_id
        model_response = await get_current_live2d_model(target_name, live2d_item_id)
        # 提取JSONResponse中的内容
        model_data = model_response.body.decode('utf-8')
        import json
        model_json = json.loads(model_data)
        model_info = model_json.get('model_info', {})
        model_path = model_info.get('path', '')
        
        return {
            "success": True,
            "lanlan_name": target_name,
            "model_path": model_path
        }
    except Exception as e:
        logger.error(f"获取页面配置失败: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "lanlan_name": "",
            "model_path": ""
        }

@app.get("/api/config/core_api")
async def get_core_config_api():
    """获取核心配置（API Key）"""
    try:
        # 尝试从core_config.json读取
        try:
            from utils.config_manager import get_config_manager
            config_manager = get_config_manager()
            core_config_path = str(config_manager.get_config_path('core_config.json'))
            with open(core_config_path, 'r', encoding='utf-8') as f:
                core_cfg = json.load(f)
                api_key = core_cfg.get('coreApiKey', '')
        except FileNotFoundError:
            # 如果文件不存在，返回当前配置中的CORE_API_KEY
            core_config = _config_manager.get_core_config()
            api_key = core_config['CORE_API_KEY']
            # 创建空的配置对象用于返回默认值
            core_cfg = {}
        
        return {
            "api_key": api_key,
            "coreApi": core_cfg.get('coreApi', 'qwen'),
            "assistApi": core_cfg.get('assistApi', 'qwen'),
            "assistApiKeyQwen": core_cfg.get('assistApiKeyQwen', ''),
            "assistApiKeyOpenai": core_cfg.get('assistApiKeyOpenai', ''),
            "assistApiKeyGlm": core_cfg.get('assistApiKeyGlm', ''),
            "assistApiKeyStep": core_cfg.get('assistApiKeyStep', ''),
            "assistApiKeySilicon": core_cfg.get('assistApiKeySilicon', ''),
            "mcpToken": core_cfg.get('mcpToken', ''),  # 添加mcpToken字段
            "enableCustomApi": core_cfg.get('enableCustomApi', False),  # 添加enableCustomApi字段
            # 自定义API相关字段
            "summaryModelProvider": core_cfg.get('summaryModelProvider', ''),
            "summaryModelUrl": core_cfg.get('summaryModelUrl', ''),
            "summaryModelId": core_cfg.get('summaryModelId', ''),
            "summaryModelApiKey": core_cfg.get('summaryModelApiKey', ''),
            "correctionModelProvider": core_cfg.get('correctionModelProvider', ''),
            "correctionModelUrl": core_cfg.get('correctionModelUrl', ''),
            "correctionModelId": core_cfg.get('correctionModelId', ''),
            "correctionModelApiKey": core_cfg.get('correctionModelApiKey', ''),
            "emotionModelProvider": core_cfg.get('emotionModelProvider', ''),
            "emotionModelUrl": core_cfg.get('emotionModelUrl', ''),
            "emotionModelId": core_cfg.get('emotionModelId', ''),
            "emotionModelApiKey": core_cfg.get('emotionModelApiKey', ''),
            "visionModelProvider": core_cfg.get('visionModelProvider', ''),
            "visionModelUrl": core_cfg.get('visionModelUrl', ''),
            "visionModelId": core_cfg.get('visionModelId', ''),
            "visionModelApiKey": core_cfg.get('visionModelApiKey', ''),
            "omniModelProvider": core_cfg.get('omniModelProvider', ''),
            "omniModelUrl": core_cfg.get('omniModelUrl', ''),
            "omniModelId": core_cfg.get('omniModelId', ''),
            "omniModelApiKey": core_cfg.get('omniModelApiKey', ''),
            "ttsModelProvider": core_cfg.get('ttsModelProvider', ''),
            "ttsModelUrl": core_cfg.get('ttsModelUrl', ''),
            "ttsModelId": core_cfg.get('ttsModelId', ''),
            "ttsModelApiKey": core_cfg.get('ttsModelApiKey', ''),
            "success": True
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/config/api_providers")
async def get_api_providers_config():
    """获取API服务商配置（供前端使用）"""
    try:
        from utils.api_config_loader import (
            get_core_api_providers_for_frontend,
            get_assist_api_providers_for_frontend,
        )
        
        # 使用缓存加载配置（性能更好，配置更新后需要重启服务）
        core_providers = get_core_api_providers_for_frontend()
        assist_providers = get_assist_api_providers_for_frontend()
        
        return {
            "success": True,
            "core_api_providers": core_providers,
            "assist_api_providers": assist_providers,
        }
    except Exception as e:
        logger.error(f"获取API服务商配置失败: {e}")
        return {
            "success": False,
            "error": str(e),
            "core_api_providers": [],
            "assist_api_providers": [],
        }


@app.post("/api/config/core_api")
async def update_core_config(request: Request):
    """更新核心配置（API Key）"""
    try:
        data = await request.json()
        if not data:
            return {"success": False, "error": "无效的数据"}
        
        # 检查是否启用了自定义API
        enable_custom_api = data.get('enableCustomApi', False)
        
        # 如果启用了自定义API，不需要强制检查核心API key
        if not enable_custom_api:
            # 检查是否为免费版配置
            is_free_version = data.get('coreApi') == 'free' or data.get('assistApi') == 'free'
            
            if 'coreApiKey' not in data:
                return {"success": False, "error": "缺少coreApiKey字段"}
            
            api_key = data['coreApiKey']
            if api_key is None:
                return {"success": False, "error": "API Key不能为null"}
            
            if not isinstance(api_key, str):
                return {"success": False, "error": "API Key必须是字符串类型"}
            
            api_key = api_key.strip()
            
            # 免费版允许使用 'free-access' 作为API key，不进行空值检查
            if not is_free_version and not api_key:
                return {"success": False, "error": "API Key不能为空"}
        
        # 保存到core_config.json
        from pathlib import Path
        from utils.config_manager import get_config_manager
        config_manager = get_config_manager()
        core_config_path = str(config_manager.get_config_path('core_config.json'))
        # 确保配置目录存在
        Path(core_config_path).parent.mkdir(parents=True, exist_ok=True)
        
        # 构建配置对象
        core_cfg = {}
        
        # 只有在启用自定义API时，才允许不设置coreApiKey
        if enable_custom_api:
            # 启用自定义API时，coreApiKey是可选的
            if 'coreApiKey' in data:
                api_key = data['coreApiKey']
                if api_key is not None and isinstance(api_key, str):
                    core_cfg['coreApiKey'] = api_key.strip()
        else:
            # 未启用自定义API时，必须设置coreApiKey
            api_key = data.get('coreApiKey', '')
            if api_key is not None and isinstance(api_key, str):
                core_cfg['coreApiKey'] = api_key.strip()
        if 'coreApi' in data:
            core_cfg['coreApi'] = data['coreApi']
        if 'assistApi' in data:
            core_cfg['assistApi'] = data['assistApi']
        if 'assistApiKeyQwen' in data:
            core_cfg['assistApiKeyQwen'] = data['assistApiKeyQwen']
        if 'assistApiKeyOpenai' in data:
            core_cfg['assistApiKeyOpenai'] = data['assistApiKeyOpenai']
        if 'assistApiKeyGlm' in data:
            core_cfg['assistApiKeyGlm'] = data['assistApiKeyGlm']
        if 'assistApiKeyStep' in data:
            core_cfg['assistApiKeyStep'] = data['assistApiKeyStep']
        if 'assistApiKeySilicon' in data:
            core_cfg['assistApiKeySilicon'] = data['assistApiKeySilicon']
        if 'mcpToken' in data:
            core_cfg['mcpToken'] = data['mcpToken']
        if 'enableCustomApi' in data:
            core_cfg['enableCustomApi'] = data['enableCustomApi']
        
        # 添加用户自定义API配置
        if 'summaryModelProvider' in data:
            core_cfg['summaryModelProvider'] = data['summaryModelProvider']
        if 'summaryModelUrl' in data:
            core_cfg['summaryModelUrl'] = data['summaryModelUrl']
        if 'summaryModelId' in data:
            core_cfg['summaryModelId'] = data['summaryModelId']
        if 'summaryModelApiKey' in data:
            core_cfg['summaryModelApiKey'] = data['summaryModelApiKey']
        if 'correctionModelProvider' in data:
            core_cfg['correctionModelProvider'] = data['correctionModelProvider']
        if 'correctionModelUrl' in data:
            core_cfg['correctionModelUrl'] = data['correctionModelUrl']
        if 'correctionModelId' in data:
            core_cfg['correctionModelId'] = data['correctionModelId']
        if 'correctionModelApiKey' in data:
            core_cfg['correctionModelApiKey'] = data['correctionModelApiKey']
        if 'emotionModelProvider' in data:
            core_cfg['emotionModelProvider'] = data['emotionModelProvider']
        if 'emotionModelUrl' in data:
            core_cfg['emotionModelUrl'] = data['emotionModelUrl']
        if 'emotionModelId' in data:
            core_cfg['emotionModelId'] = data['emotionModelId']
        if 'emotionModelApiKey' in data:
            core_cfg['emotionModelApiKey'] = data['emotionModelApiKey']
        if 'visionModelProvider' in data:
            core_cfg['visionModelProvider'] = data['visionModelProvider']
        if 'visionModelUrl' in data:
            core_cfg['visionModelUrl'] = data['visionModelUrl']
        if 'visionModelId' in data:
            core_cfg['visionModelId'] = data['visionModelId']
        if 'visionModelApiKey' in data:
            core_cfg['visionModelApiKey'] = data['visionModelApiKey']
        if 'omniModelProvider' in data:
            core_cfg['omniModelProvider'] = data['omniModelProvider']
        if 'omniModelUrl' in data:
            core_cfg['omniModelUrl'] = data['omniModelUrl']
        if 'omniModelId' in data:
            core_cfg['omniModelId'] = data['omniModelId']
        if 'omniModelApiKey' in data:
            core_cfg['omniModelApiKey'] = data['omniModelApiKey']
        if 'ttsModelProvider' in data:
            core_cfg['ttsModelProvider'] = data['ttsModelProvider']
        if 'ttsModelUrl' in data:
            core_cfg['ttsModelUrl'] = data['ttsModelUrl']
        if 'ttsModelId' in data:
            core_cfg['ttsModelId'] = data['ttsModelId']
        if 'ttsModelApiKey' in data:
            core_cfg['ttsModelApiKey'] = data['ttsModelApiKey']
        
        with open(core_config_path, 'w', encoding='utf-8') as f:
            json.dump(core_cfg, f, indent=2, ensure_ascii=False)
        
        # API配置更新后，需要先通知所有客户端，再关闭session，最后重新加载配置
        logger.info("API配置已更新，准备通知客户端并重置所有session...")
        
        # 1. 先通知所有连接的客户端即将刷新（WebSocket还连着）
        notification_count = 0
        for lanlan_name, mgr in session_manager.items():
            if mgr.is_active and mgr.websocket:
                try:
                    await mgr.websocket.send_text(json.dumps({
                        "type": "reload_page",
                        "message": "API配置已更新，页面即将刷新"
                    }))
                    notification_count += 1
                    logger.info(f"已通知 {lanlan_name} 的前端刷新页面")
                except Exception as e:
                    logger.warning(f"通知 {lanlan_name} 的WebSocket失败: {e}")
        
        logger.info(f"已通知 {notification_count} 个客户端")
        
        # 2. 立刻关闭所有活跃的session（这会断开所有WebSocket）
        sessions_ended = []
        for lanlan_name, mgr in session_manager.items():
            if mgr.is_active:
                try:
                    await mgr.end_session(by_server=True)
                    sessions_ended.append(lanlan_name)
                    logger.info(f"{lanlan_name} 的session已结束")
                except Exception as e:
                    logger.error(f"结束 {lanlan_name} 的session时出错: {e}")
        
        # 3. 重新加载配置并重建session manager
        logger.info("正在重新加载配置...")
        try:
            await initialize_character_data()
            logger.info("配置重新加载完成，新的API配置已生效")
        except Exception as reload_error:
            logger.error(f"重新加载配置失败: {reload_error}")
            return {"success": False, "error": f"配置已保存但重新加载失败: {str(reload_error)}"}
        
        logger.info(f"已通知 {notification_count} 个连接的客户端API配置已更新")
        return {"success": True, "message": "API Key已保存并重新加载配置", "sessions_ended": len(sessions_ended)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.on_event("startup")
async def startup_event():
    global sync_process
    logger.info("Starting main server...")
    
    # ========== 初始化创意工坊目录 ==========
    # 依赖方向: main_server → utils → config (单向)
    # main 层只负责调用 utils，不维护任何 workshop 状态
    # 路径由 utils 层管理并持久化到 config 层
    await _init_and_mount_workshop()
    
    # ========== 启动同步连接器线程 ==========
    logger.info("Starting sync connector threads")
    # 启动同步连接器线程（确保所有角色都有线程）
    for k in list(sync_message_queue.keys()):
        if k not in sync_process or sync_process[k] is None or (hasattr(sync_process.get(k), 'is_alive') and not sync_process[k].is_alive()):
            if k in sync_process and sync_process[k] is not None:
                # 清理已停止的线程
                try:
                    sync_process[k].join(timeout=0.1)
                except:
                    pass
            try:
                sync_process[k] = Thread(
                    target=cross_server.sync_connector_process,
                    args=(sync_message_queue[k], sync_shutdown_event[k], k, f"ws://localhost:{MONITOR_SERVER_PORT}", {'bullet': False, 'monitor': True}),
                    daemon=True,
                    name=f"SyncConnector-{k}"
                )
                sync_process[k].start()
                logger.info(f"✅ 同步连接器线程已启动 ({sync_process[k].name}) for {k}")
                # 检查线程是否成功启动
                await asyncio.sleep(0.1)  # 线程启动更快
                if not sync_process[k].is_alive():
                    logger.error(f"❌ 同步连接器线程 {k} ({sync_process[k].name}) 启动后立即退出！")
                else:
                    logger.info(f"✅ 同步连接器线程 {k} ({sync_process[k].name}) 正在运行")
            except Exception as e:
                logger.error(f"❌ 启动角色 {k} 的同步连接器线程失败: {e}", exc_info=True)
    
    # 如果启用了浏览器模式，在服务器启动完成后打开浏览器
    current_config = get_start_config()
    print(f"启动配置: {current_config}")
    if current_config['browser_mode_enabled']:
        import threading
        
        def launch_browser_delayed():
            # 等待一小段时间确保服务器完全启动
            import time
            time.sleep(1)
            # 从 app.state 获取配置
            config = get_start_config()
            url = f"http://127.0.0.1:{MAIN_SERVER_PORT}/{config['browser_page']}"
            try:
                webbrowser.open(url)
                logger.info(f"服务器启动完成，已打开浏览器访问: {url}")
            except Exception as e:
                logger.error(f"打开浏览器失败: {e}")
        
        # 在独立线程中启动浏览器
        t = threading.Thread(target=launch_browser_delayed, daemon=True)
        t.start()


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时执行"""
    logger.info("Shutting down sync connector threads")
    # 关闭同步服务器连接（线程只能协作式终止）
    for k in sync_process:
        if sync_process[k] is not None:
            sync_shutdown_event[k].set()
            sync_process[k].join(timeout=3)  # 等待线程正常结束
            if sync_process[k].is_alive():
                logger.warning(f"⚠️ 同步连接器线程 {k} 未能在超时内停止，将作为daemon线程随主进程退出")
    logger.info("同步连接器线程已停止")
    
    # 向memory_server发送关闭信号
    try:
        from config import MEMORY_SERVER_PORT
        shutdown_url = f"http://localhost:{MEMORY_SERVER_PORT}/shutdown"
        async with httpx.AsyncClient(timeout=2) as client:
            response = await client.post(shutdown_url)
            if response.status_code == 200:
                logger.info("已向memory_server发送关闭信号")
            else:
                logger.warning(f"向memory_server发送关闭信号失败，状态码: {response.status_code}")
    except Exception as e:
        logger.warning(f"向memory_server发送关闭信号时出错: {e}")


@app.websocket("/ws/{lanlan_name}")
async def websocket_endpoint(websocket: WebSocket, lanlan_name: str):
    await websocket.accept()
    
    # 检查角色是否存在，如果不存在则通知前端并关闭连接
    if lanlan_name not in session_manager:
        logger.warning(f"❌ 角色 {lanlan_name} 不存在，当前可用角色: {list(session_manager.keys())}")
        # 获取当前正确的角色名
        current_catgirl = None
        if session_manager:
            current_catgirl = list(session_manager.keys())[0]
        # 通知前端切换到正确的角色
        if current_catgirl:
            try:
                await websocket.send_text(json.dumps({
                    "type": "catgirl_switched",
                    "new_catgirl": current_catgirl,
                    "old_catgirl": lanlan_name
                }))
                logger.info(f"已通知前端切换到正确的角色: {current_catgirl}")
                # 等待一下让客户端有时间处理消息，避免 onclose 在 onmessage 之前触发
                await asyncio.sleep(0.5)
            except Exception as e:
                logger.warning(f"通知前端失败: {e}")
        await websocket.close()
        return
    
    this_session_id = uuid.uuid4()
    async with lock:
        global session_id
        session_id[lanlan_name] = this_session_id
    logger.info(f"⭐websocketWebSocket accepted: {websocket.client}, new session id: {session_id[lanlan_name]}, lanlan_name: {lanlan_name}")
    
    # 立即设置websocket到session manager，以支持主动搭话
    # 注意：这里设置后，即使cleanup()被调用，websocket也会在start_session时重新设置
    session_manager[lanlan_name].websocket = websocket
    logger.info(f"✅ 已设置 {lanlan_name} 的WebSocket连接")

    try:
        while True:
            data = await websocket.receive_text()
            # 安全检查：如果角色已被重命名或删除，lanlan_name 可能不再存在
            if lanlan_name not in session_id or lanlan_name not in session_manager:
                logger.info(f"角色 {lanlan_name} 已被重命名或删除，关闭旧连接")
                await websocket.close()
                break
            if session_id[lanlan_name] != this_session_id:
                await session_manager[lanlan_name].send_status(f"切换至另一个终端...")
                await websocket.close()
                break
            message = json.loads(data)
            action = message.get("action")
            # logger.debug(f"WebSocket received action: {action}") # Optional debug log

            if action == "start_session":
                session_manager[lanlan_name].active_session_is_idle = False
                input_type = message.get("input_type", "audio")
                if input_type in ['audio', 'screen', 'camera', 'text']:
                    # 传递input_mode参数，告知session manager使用何种模式
                    mode = 'text' if input_type == 'text' else 'audio'
                    asyncio.create_task(session_manager[lanlan_name].start_session(websocket, message.get("new_session", False), mode))
                else:
                    await session_manager[lanlan_name].send_status(f"Invalid input type: {input_type}")

            elif action == "stream_data":
                asyncio.create_task(session_manager[lanlan_name].stream_data(message))

            elif action == "end_session":
                session_manager[lanlan_name].active_session_is_idle = False
                asyncio.create_task(session_manager[lanlan_name].end_session())

            elif action == "pause_session":
                session_manager[lanlan_name].active_session_is_idle = True
                asyncio.create_task(session_manager[lanlan_name].end_session())

            elif action == "ping":
                # 心跳保活消息，回复pong
                await websocket.send_text(json.dumps({"type": "pong"}))
                # logger.debug(f"收到心跳ping，已回复pong")

            else:
                logger.warning(f"Unknown action received: {action}")
                await session_manager[lanlan_name].send_status(f"Unknown action: {action}")

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {websocket.client}")
    except Exception as e:
        error_message = f"WebSocket handler error: {e}"
        logger.error(f"💥 {error_message}")
        try:
            if lanlan_name in session_manager:
                await session_manager[lanlan_name].send_status(f"Server error: {e}")
        except:
            pass
    finally:
        logger.info(f"Cleaning up WebSocket resources: {websocket.client}")
        # 安全检查：如果角色已被重命名或删除，lanlan_name 可能不再存在
        if lanlan_name in session_manager:
            await session_manager[lanlan_name].cleanup()
            # 注意：cleanup() 会清空 websocket，但只在连接真正断开时调用
            # 如果连接还在，websocket应该保持设置
            if session_manager[lanlan_name].websocket == websocket:
                session_manager[lanlan_name].websocket = None

@app.post('/api/notify_task_result')
async def notify_task_result(request: Request):
    """供工具/任务服务回调：在下一次正常回复之后，插入一条任务完成提示。"""
    try:
        data = await request.json()
        # 如果未显式提供，则使用当前默认角色
        _, her_name_current, _, _, _, _, _, _, _, _ = _config_manager.get_character_data()
        lanlan = data.get('lanlan_name') or her_name_current
        text = (data.get('text') or '').strip()
        if not text:
            return JSONResponse({"success": False, "error": "text required"}, status_code=400)
        mgr = session_manager.get(lanlan)
        if not mgr:
            return JSONResponse({"success": False, "error": "lanlan not found"}, status_code=404)
        # 将提示加入待插入队列
        mgr.pending_extra_replies.append(text)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

@app.post('/api/proactive_chat')
async def proactive_chat(request: Request):
    """主动搭话：爬取热门内容，让AI决定是否主动发起对话"""
    try:
        from utils.web_scraper import fetch_trending_content, format_trending_content
        
        # 获取当前角色数据
        master_name_current, her_name_current, _, _, _, _, _, _, _, _ = _config_manager.get_character_data()
        
        data = await request.json()
        lanlan_name = data.get('lanlan_name') or her_name_current
        
        # 获取session manager
        mgr = session_manager.get(lanlan_name)
        if not mgr:
            return JSONResponse({"success": False, "error": f"角色 {lanlan_name} 不存在"}, status_code=404)
        
        # 检查是否正在响应中（如果正在说话，不打断）
        if mgr.is_active and hasattr(mgr.session, '_is_responding') and mgr.session._is_responding:
            return JSONResponse({
                "success": False, 
                "error": "AI正在响应中，无法主动搭话",
                "message": "请等待当前响应完成"
            }, status_code=409)
        
        logger.info(f"[{lanlan_name}] 开始主动搭话流程...")
        
        # 1. 爬取热门内容
        try:
            trending_content = await fetch_trending_content(bilibili_limit=10, weibo_limit=10)
            
            if not trending_content['success']:
                return JSONResponse({
                    "success": False,
                    "error": "无法获取热门内容",
                    "detail": trending_content.get('error', '未知错误')
                }, status_code=500)
            
            formatted_content = format_trending_content(trending_content)
            logger.info(f"[{lanlan_name}] 成功获取热门内容")
            
        except Exception as e:
            logger.error(f"[{lanlan_name}] 获取热门内容失败: {e}")
            return JSONResponse({
                "success": False,
                "error": "爬取热门内容时出错",
                "detail": str(e)
            }, status_code=500)
        
        # 2. 获取new_dialogue prompt
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"http://localhost:{MEMORY_SERVER_PORT}/new_dialog/{lanlan_name}", timeout=5.0)
                memory_context = resp.text
        except Exception as e:
            logger.warning(f"[{lanlan_name}] 获取记忆上下文失败，使用空上下文: {e}")
            memory_context = ""
        
        # 3. 构造提示词（使用prompts_sys中的模板）
        system_prompt = proactive_chat_prompt.format(
            lanlan_name=lanlan_name,
            master_name=master_name_current,
            trending_content=formatted_content,
            memory_context=memory_context
        )

        # 4. 直接使用langchain ChatOpenAI获取AI回复（不创建临时session）
        try:
            core_config = _config_manager.get_core_config()
            
            # 直接使用langchain ChatOpenAI发送请求
            from langchain_openai import ChatOpenAI
            from langchain_core.messages import SystemMessage
            from openai import APIConnectionError, InternalServerError, RateLimitError
            
            llm = ChatOpenAI(
                model=core_config['CORRECTION_MODEL'],
                base_url=core_config['OPENROUTER_URL'],
                api_key=core_config['OPENROUTER_API_KEY'],
                temperature=1.1,
                streaming=False  # 不需要流式，直接获取完整响应
            )
            
            # 发送请求获取AI决策 - Retry策略：重试2次，间隔1秒、2秒
            print(system_prompt)
            max_retries = 3
            retry_delays = [1, 2]
            response_text = ""
            
            for attempt in range(max_retries):
                try:
                    response = await asyncio.wait_for(
                        llm.ainvoke([SystemMessage(content=system_prompt)]),
                        timeout=10.0
                    )
                    response_text = response.content.strip()
                    break  # 成功则退出重试循环
                except (APIConnectionError, InternalServerError, RateLimitError) as e:
                    if attempt < max_retries - 1:
                        wait_time = retry_delays[attempt]
                        logger.warning(f"[{lanlan_name}] 主动搭话LLM调用失败 (尝试 {attempt + 1}/{max_retries})，{wait_time}秒后重试: {e}")
                        # 向前端发送状态提示
                        if mgr.websocket:
                            try:
                                await mgr.send_status(f"正在重试中...（第{attempt + 1}次）")
                            except:
                                pass
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(f"[{lanlan_name}] 主动搭话LLM调用失败，已达到最大重试次数: {e}")
                        return JSONResponse({
                            "success": False,
                            "error": f"AI调用失败，已重试{max_retries}次",
                            "detail": str(e)
                        }, status_code=503)
            
            logger.info(f"[{lanlan_name}] AI决策结果: {response_text[:100]}...")
            
            # 5. 判断AI是否选择搭话
            if "[PASS]" in response_text or not response_text:
                return JSONResponse({
                    "success": True,
                    "action": "pass",
                    "message": "AI选择暂时不搭话"
                })
            
            # 6. AI选择搭话，需要通过session manager处理
            # 首先检查是否有真实的websocket连接
            if not mgr.websocket:
                return JSONResponse({
                    "success": False,
                    "error": "没有活跃的WebSocket连接，无法主动搭话。请先打开前端页面。"
                }, status_code=400)
            
            # 检查websocket是否连接
            try:
                from starlette.websockets import WebSocketState
                if hasattr(mgr.websocket, 'client_state'):
                    if mgr.websocket.client_state != WebSocketState.CONNECTED:
                        return JSONResponse({
                            "success": False,
                            "error": "WebSocket未连接，无法主动搭话"
                        }, status_code=400)
            except Exception as e:
                logger.warning(f"检查WebSocket状态失败: {e}")
            
            # 检查是否有现有的session，如果没有则创建一个文本session
            session_created = False
            if not mgr.session or not hasattr(mgr.session, '_conversation_history'):
                logger.info(f"[{lanlan_name}] 没有活跃session，创建文本session用于主动搭话")
                # 使用现有的真实websocket启动session
                await mgr.start_session(mgr.websocket, new=True, input_mode='text')
                session_created = True
                logger.info(f"[{lanlan_name}] 文本session已创建")
            
            # 如果是新创建的session，等待TTS准备好
            if session_created and mgr.use_tts:
                logger.info(f"[{lanlan_name}] 等待TTS准备...")
                max_wait = 5  # 最多等待5秒
                wait_step = 0.1
                waited = 0
                while waited < max_wait:
                    async with mgr.tts_cache_lock:
                        if mgr.tts_ready:
                            logger.info(f"[{lanlan_name}] TTS已准备好")
                            break
                    await asyncio.sleep(wait_step)
                    waited += wait_step
                
                if waited >= max_wait:
                    logger.warning(f"[{lanlan_name}] TTS准备超时，继续发送（可能没有语音）")
            
            # 现在可以将AI的话添加到对话历史中
            from langchain_core.messages import AIMessage
            mgr.session._conversation_history.append(AIMessage(content=response_text))
            logger.info(f"[{lanlan_name}] 已将主动搭话添加到对话历史")
            
            # 生成新的speech_id（用于TTS）
            from uuid import uuid4
            async with mgr.lock:
                mgr.current_speech_id = str(uuid4())
            
            # 通过handle_text_data处理这段话（触发TTS和前端显示）
            # 分chunk发送以模拟流式效果
            chunks = [response_text[i:i+10] for i in range(0, len(response_text), 10)]
            for i, chunk in enumerate(chunks):
                await mgr.handle_text_data(chunk, is_first_chunk=(i == 0))
                await asyncio.sleep(0.05)  # 小延迟模拟流式
            
            # 调用response完成回调
            if hasattr(mgr, 'handle_response_complete'):
                await mgr.handle_response_complete()
            
            return JSONResponse({
                "success": True,
                "action": "chat",
                "message": "主动搭话已发送",
                "lanlan_name": lanlan_name
            })
            
        except asyncio.TimeoutError:
            logger.error(f"[{lanlan_name}] AI回复超时")
            return JSONResponse({
                "success": False,
                "error": "AI处理超时"
            }, status_code=504)
        except Exception as e:
            logger.error(f"[{lanlan_name}] AI处理失败: {e}")
            return JSONResponse({
                "success": False,
                "error": "AI处理失败",
                "detail": str(e)
            }, status_code=500)
        
    except Exception as e:
        logger.error(f"主动搭话接口异常: {e}")
        return JSONResponse({
            "success": False,
            "error": "服务器内部错误",
            "detail": str(e)
        }, status_code=500)

@app.get("/model", response_class=HTMLResponse)
@app.get("/l2d", response_class=HTMLResponse)  # 向后兼容别名
async def get_model_manager(request: Request):
    """渲染模型管理器页面（支持Live2D和VRM）"""
    return templates.TemplateResponse("templates/model_manager.html", {
        "request": request
    })

@app.get("/live2d_parameter_editor", response_class=HTMLResponse)
async def live2d_parameter_editor(request: Request):
    """Live2D参数编辑器页面"""
    return templates.TemplateResponse("templates/live2d_parameter_editor.html", {
        "request": request
    })

@app.get('/api/characters/current_live2d_model')
async def get_current_live2d_model(catgirl_name: str = "", item_id: str = ""):
    """获取指定角色或当前角色的Live2D模型信息
    
    Args:
        catgirl_name: 角色名称
        item_id: 可选的物品ID，用于直接指定模型
    """
    try:
        characters = _config_manager.load_characters()
        
        # 如果没有指定角色名称，使用当前猫娘
        if not catgirl_name:
            catgirl_name = characters.get('当前猫娘', '')
        
        # 查找指定角色的Live2D模型
        live2d_model_name = None
        model_info = None
        
        # 首先尝试通过item_id查找模型
        if item_id:
            try:
                logger.debug(f"尝试通过item_id {item_id} 查找模型")
                # 获取所有模型
                all_models = find_models()
                # 查找匹配item_id的模型
                matching_model = next((m for m in all_models if m.get('item_id') == item_id), None)
                
                if matching_model:
                    logger.debug(f"通过item_id找到模型: {matching_model['name']}")
                    # 复制模型信息
                    model_info = matching_model.copy()
                    live2d_model_name = model_info['name']
            except Exception as e:
                logger.warning(f"通过item_id查找模型失败: {e}")
        
        # 如果没有通过item_id找到模型，再通过角色名称查找
        if not model_info and catgirl_name:
            # 在猫娘列表中查找
            if '猫娘' in characters and catgirl_name in characters['猫娘']:
                catgirl_data = characters['猫娘'][catgirl_name]
                live2d_model_name = catgirl_data.get('live2d')
                
                # 检查是否有保存的item_id
                saved_item_id = catgirl_data.get('live2d_item_id')
                if saved_item_id:
                    logger.debug(f"发现角色 {catgirl_name} 保存的item_id: {saved_item_id}")
                    try:
                        # 尝试通过保存的item_id查找模型
                        all_models = find_models()
                        matching_model = next((m for m in all_models if m.get('item_id') == saved_item_id), None)
                        if matching_model:
                            logger.debug(f"通过保存的item_id找到模型: {matching_model['name']}")
                            model_info = matching_model.copy()
                            live2d_model_name = model_info['name']
                    except Exception as e:
                        logger.warning(f"通过保存的item_id查找模型失败: {e}")
        
        # 如果找到了模型名称，获取模型信息
        if live2d_model_name:
            try:
                # 先从完整的模型列表中查找，这样可以获取到item_id等完整信息
                all_models = find_models()
                # 查找匹配的模型
                matching_model = next((m for m in all_models if m['name'] == live2d_model_name), None)
                
                if matching_model:
                    # 使用完整的模型信息，包含item_id
                    model_info = matching_model.copy()
                    logger.debug(f"从完整模型列表获取模型信息: {model_info}")
                else:
                    # 如果在完整列表中找不到，回退到原来的逻辑
                    model_dir, url_prefix = find_model_directory(live2d_model_name)
                    if os.path.exists(model_dir):
                        # 查找模型配置文件
                        model_files = [f for f in os.listdir(model_dir) if f.endswith('.model3.json')]
                        if model_files:
                            model_file = model_files[0]
                            
                            # 使用保存的item_id构建model_path
                            # 从之前的逻辑中获取saved_item_id
                            saved_item_id = catgirl_data.get('live2d_item_id', '') if 'catgirl_data' in locals() else ''
                            
                            # 如果有保存的item_id，使用它构建路径
                            if saved_item_id:
                                model_path = f'{url_prefix}/{saved_item_id}/{model_file}'
                                logger.debug(f"使用保存的item_id构建模型路径: {model_path}")
                            else:
                                # 原始路径构建逻辑
                                model_path = f'{url_prefix}/{live2d_model_name}/{model_file}'
                                logger.debug(f"使用模型名称构建路径: {model_path}")
                            
                            model_info = {
                                'name': live2d_model_name,
                                'item_id': saved_item_id,
                                'path': model_path
                            }
            except Exception as e:
                logger.warning(f"获取模型信息失败: {e}")
        
        # 回退机制：如果没有找到模型，使用默认的mao_pro
        if not live2d_model_name or not model_info:
            logger.info(f"猫娘 {catgirl_name} 未设置Live2D模型，回退到默认模型 mao_pro")
            live2d_model_name = 'mao_pro'
            try:
                # 先从完整的模型列表中查找mao_pro
                all_models = find_models()
                matching_model = next((m for m in all_models if m['name'] == 'mao_pro'), None)
                
                if matching_model:
                    model_info = matching_model.copy()
                    model_info['is_fallback'] = True
                else:
                    # 如果找不到，回退到原来的逻辑
                    model_dir, url_prefix = find_model_directory('mao_pro')
                    if os.path.exists(model_dir):
                        model_files = [f for f in os.listdir(model_dir) if f.endswith('.model3.json')]
                        if model_files:
                            model_file = model_files[0]
                            model_path = f'{url_prefix}/mao_pro/{model_file}'
                            model_info = {
                                'name': 'mao_pro',
                                'path': model_path,
                                'is_fallback': True  # 标记这是回退模型
                            }
            except Exception as e:
                logger.error(f"获取默认模型mao_pro失败: {e}")
        
        return JSONResponse(content={
            'success': True,
            'catgirl_name': catgirl_name,
            'model_name': live2d_model_name,
            'model_info': model_info
        })
        
    except Exception as e:
        logger.error(f"获取角色Live2D模型失败: {e}")
        return JSONResponse(content={
            'success': False,
            'error': str(e)
        })

@app.get('/api/characters/current_vrm_model')
async def get_current_vrm_model(catgirl_name: str = ""):
    """获取指定角色或当前角色的VRM模型信息"""
    try:
        from utils.frontend_utils import find_vrm_models
        
        characters = _config_manager.load_characters()
        
        # 如果没有指定角色名称，使用当前猫娘
        if not catgirl_name:
            catgirl_name = characters.get('当前猫娘', '')
        
        # 查找指定角色的VRM模型
        vrm_model_name = None
        model_info = None
        
        # 在猫娘列表中查找
        if '猫娘' in characters and catgirl_name in characters['猫娘']:
            catgirl_data = characters['猫娘'][catgirl_name]
            vrm_model_name = catgirl_data.get('vrm')
        
        # 如果找到了模型名称，从VRM模型列表中查找
        if vrm_model_name:
            try:
                vrm_models = find_vrm_models()
                model_info = next((m for m in vrm_models if m['name'] == vrm_model_name), None)
            except Exception as e:
                logger.warning(f"获取VRM模型信息失败: {e}")
        
        return JSONResponse(content={
            'success': True,
            'catgirl_name': catgirl_name,
            'model_name': vrm_model_name,
            'model_info': model_info
        })
        
    except Exception as e:
        logger.error(f"获取角色VRM模型失败: {e}")
        return JSONResponse(content={
            'success': False,
            'error': str(e)
        })

@app.get('/chara_manager', response_class=HTMLResponse)
async def chara_manager(request: Request):
    """渲染主控制页面"""
    return templates.TemplateResponse('templates/chara_manager.html', {"request": request})

@app.get('/voice_clone', response_class=HTMLResponse)
async def voice_clone_page(request: Request):
    return templates.TemplateResponse("templates/voice_clone.html", {"request": request})

@app.get("/api_key", response_class=HTMLResponse)
async def api_key_settings(request: Request):
    """API Key 设置页面"""
    return templates.TemplateResponse("templates/api_key_settings.html", {
        "request": request
    })

@app.get('/api/characters')
async def get_characters():
    return JSONResponse(content=_config_manager.load_characters())

@app.get('/steam_workshop_manager', response_class=HTMLResponse)
async def steam_workshop_manager_page(request: Request, lanlan_name: str = ""):
    return templates.TemplateResponse("templates/steam_workshop_manager.html", {"request": request, "lanlan_name": lanlan_name})

@app.get('/api/steam/workshop/subscribed-items')
async def get_subscribed_workshop_items():
    """
    获取用户订阅的Steam创意工坊物品列表
    返回包含物品ID、基本信息和状态的JSON数据
    """
    global steamworks
    
    # 检查Steamworks是否初始化成功
    if steamworks is None:
        return JSONResponse({
            "success": False,
            "error": "Steamworks未初始化",
            "message": "请确保Steam客户端已运行且已登录"
        }, status_code=503)
    
    try:
        # 获取订阅物品数量
        num_subscribed_items = steamworks.Workshop.GetNumSubscribedItems()
        logger.info(f"获取到 {num_subscribed_items} 个订阅的创意工坊物品")
        
        # 如果没有订阅物品，返回空列表
        if num_subscribed_items == 0:
            return {
                "success": True,
                "items": [],
                "total": 0
            }
        
        # 获取订阅物品ID列表
        subscribed_items = steamworks.Workshop.GetSubscribedItems()
        logger.info(f'获取到 {len(subscribed_items)} 个订阅的创意工坊物品')
        
        # 存储处理后的物品信息
        items_info = []
        
        # 为每个物品获取基本信息和状态
        for item_id in subscribed_items:
            try:
                # 确保item_id是整数类型
                if isinstance(item_id, str):
                    try:
                        item_id = int(item_id)
                    except ValueError:
                        logger.error(f"无效的物品ID: {item_id}")
                        continue
                
                logger.info(f'正在处理物品ID: {item_id}')
                
                # 获取物品状态
                item_state = steamworks.Workshop.GetItemState(item_id)
                logger.debug(f'物品 {item_id} 状态: {item_state}')
                
                # 初始化基本物品信息（确保所有字段都有默认值）
                # 确保publishedFileId始终为字符串类型，避免前端toString()错误
                item_info = {
                    "publishedFileId": str(item_id),
                    "title": f"未知物品_{item_id}",
                    "description": "无法获取详细描述",
                    "tags": [],
                    "state": {
                        "subscribed": bool(item_state & 1),  # EItemState.SUBSCRIBED
                        "legacyItem": bool(item_state & 2),
                        "installed": False,
                        "needsUpdate": bool(item_state & 8),  # EItemState.NEEDS_UPDATE
                        "downloading": False,
                        "downloadPending": bool(item_state & 32),  # EItemState.DOWNLOAD_PENDING
                        "isWorkshopItem": bool(item_state & 128)  # EItemState.IS_WORKSHOP_ITEM
                    },
                    "installedFolder": None,
                    "fileSizeOnDisk": 0,
                    "downloadProgress": {
                        "bytesDownloaded": 0,
                        "bytesTotal": 0,
                        "percentage": 0
                    },
                    # 添加额外的时间戳信息 - 使用datetime替代time模块避免命名冲突
                    "timeAdded": int(datetime.now().timestamp()),
                    "timeUpdated": int(datetime.now().timestamp())
                }
                
                # 尝试获取物品安装信息（如果已安装）
                try:
                    logger.debug(f'获取物品 {item_id} 的安装信息')
                    result = steamworks.Workshop.GetItemInstallInfo(item_id)
                    
                    # 检查返回值的结构 - 支持字典格式（根据日志显示）
                    if isinstance(result, dict):
                        logger.debug(f'物品 {item_id} 安装信息字典: {result}')
                        
                        # 从字典中提取信息
                        item_info["state"]["installed"] = True  # 如果返回字典，假设已安装
                        # 获取安装路径 - workshop.py中已经将folder解码为字符串
                        folder_path = result.get('folder', '')
                        item_info["installedFolder"] = str(folder_path) if folder_path else None
                        logger.debug(f'物品 {item_id} 的安装路径: {item_info["installedFolder"]}')
                        
                        # 处理磁盘大小 - GetItemInstallInfo返回的disk_size是普通整数
                        disk_size = result.get('disk_size', 0)
                        item_info["fileSizeOnDisk"] = int(disk_size) if isinstance(disk_size, (int, float)) else 0
                    # 也支持元组格式作为备选
                    elif isinstance(result, tuple) and len(result) >= 3:
                        installed, folder, size = result
                        logger.debug(f'物品 {item_id} 安装状态: 已安装={installed}, 路径={folder}, 大小={size}')
                        
                        # 安全的类型转换
                        item_info["state"]["installed"] = bool(installed)
                        item_info["installedFolder"] = str(folder) if folder and isinstance(folder, (str, bytes)) else None
                        
                        # 处理大小值
                        if isinstance(size, (int, float)):
                            item_info["fileSizeOnDisk"] = int(size)
                        else:
                            item_info["fileSizeOnDisk"] = 0
                    else:
                        logger.warning(f'物品 {item_id} 的安装信息返回格式未知: {type(result)} - {result}')
                        item_info["state"]["installed"] = False
                except Exception as e:
                    logger.warning(f'获取物品 {item_id} 安装信息失败: {e}')
                    item_info["state"]["installed"] = False
                
                # 尝试获取物品下载信息（如果正在下载）
                try:
                    logger.debug(f'获取物品 {item_id} 的下载信息')
                    result = steamworks.Workshop.GetItemDownloadInfo(item_id)
                    
                    # 检查返回值的结构 - 支持字典格式（与安装信息保持一致）
                    if isinstance(result, dict):
                        logger.debug(f'物品 {item_id} 下载信息字典: {result}')
                        
                        # 使用正确的键名获取下载信息
                        downloaded = result.get('downloaded', 0)
                        total = result.get('total', 0)
                        progress = result.get('progress', 0.0)
                        
                        # 根据total和downloaded确定是否正在下载
                        item_info["state"]["downloading"] = total > 0 and downloaded < total
                        
                        # 设置下载进度信息
                        if downloaded > 0 or total > 0:
                            item_info["downloadProgress"] = {
                                "bytesDownloaded": int(downloaded),
                                "bytesTotal": int(total),
                                "percentage": progress * 100 if isinstance(progress, (int, float)) else 0
                            }
                    # 也支持元组格式作为备选
                    elif isinstance(result, tuple) and len(result) >= 3:
                        # 元组中应该包含下载状态、已下载字节数和总字节数
                        downloaded, total, progress = result if len(result) >= 3 else (0, 0, 0.0)
                        logger.debug(f'物品 {item_id} 下载状态: 已下载={downloaded}, 总计={total}, 进度={progress}')
                        
                        # 根据total和downloaded确定是否正在下载
                        item_info["state"]["downloading"] = total > 0 and downloaded < total
                        
                        # 设置下载进度信息
                        if downloaded > 0 or total > 0:
                            # 处理可能的类型转换
                            try:
                                downloaded_value = int(downloaded.value) if hasattr(downloaded, 'value') else int(downloaded)
                                total_value = int(total.value) if hasattr(total, 'value') else int(total)
                                progress_value = float(progress.value) if hasattr(progress, 'value') else float(progress)
                            except:
                                downloaded_value, total_value, progress_value = 0, 0, 0.0
                                
                            item_info["downloadProgress"] = {
                                "bytesDownloaded": downloaded_value,
                                "bytesTotal": total_value,
                                "percentage": progress_value * 100
                            }
                    else:
                        logger.warning(f'物品 {item_id} 的下载信息返回格式未知: {type(result)} - {result}')
                        item_info["state"]["downloading"] = False
                except Exception as e:
                    logger.warning(f'获取物品 {item_id} 下载信息失败: {e}')
                    item_info["state"]["downloading"] = False
                
                # 尝试获取物品详细信息（标题、描述等）- 使用官方推荐的方式
                try:
                    # 使用官方推荐的CreateQueryUGCDetailsRequest和SendQueryUGCRequest方法
                    logger.debug(f'使用官方推荐方法获取物品 {item_id} 的详细信息')
                    
                    # 创建UGC详情查询请求
                    query_handle = steamworks.Workshop.CreateQueryUGCDetailsRequest([item_id])
                    
                    if query_handle:
                        # 设置回调函数
                        details_received = False
                        
                        def query_completed_callback(result):
                            nonlocal details_received
                            details_received = True
                            # 回调结果会在主线程中通过GetQueryUGCResult获取
                            pass
                        
                        # 设置回调
                        steamworks.Workshop.SetQueryUGCRequestCallback(query_completed_callback)
                        
                        # 发送查询请求
                        steamworks.Workshop.SendQueryUGCRequest(query_handle)
                        
                        # 等待查询完成（简单的轮询方式）
                        import time
                        timeout = 2  # 2秒超时
                        start_time = time.time()
                        
                        # 由于这是异步回调，我们简单地等待一小段时间让查询有机会完成
                        time.sleep(0.5)  # 等待0.5秒
                        
                        try:
                            # 尝试获取查询结果
                            result = steamworks.Workshop.GetQueryUGCResult(query_handle, 0)
                            if result:
                                # 从结果中提取信息
                                if hasattr(result, 'title') and result.title:
                                    item_info['title'] = result.title.decode('utf-8', errors='replace')
                                if hasattr(result, 'description') and result.description:
                                    item_info['description'] = result.description.decode('utf-8', errors='replace')
                                # 获取创建和更新时间
                                if hasattr(result, 'timeCreated'):
                                    item_info['timeAdded'] = int(result.timeCreated)
                                if hasattr(result, 'timeUpdated'):
                                    item_info['timeUpdated'] = int(result.timeUpdated)
                                # 获取作者信息
                                if hasattr(result, 'steamIDOwner'):
                                    item_info['steamIDOwner'] = str(result.steamIDOwner)
                                # 获取文件大小信息
                                if hasattr(result, 'fileSize'):
                                    item_info['fileSizeOnDisk'] = int(result.fileSize)
                                
                                logger.info(f"成功获取物品 {item_id} 的详情信息")
                        except Exception as query_error:
                            logger.warning(f"获取查询结果时出错: {query_error}")
                except Exception as api_error:
                    logger.warning(f"使用官方API获取物品 {item_id} 详情时出错: {api_error}")
                
                # 作为备选方案，如果本地有安装路径，尝试从本地文件获取信息
                if item_info['title'].startswith('未知物品_') or not item_info['description']:
                    install_folder = item_info.get('installedFolder')
                    if install_folder and os.path.exists(install_folder):
                        logger.debug(f'尝试从安装文件夹获取物品信息: {install_folder}')
                        # 查找可能的配置文件来获取更多信息
                        config_files = [
                            os.path.join(install_folder, "config.json"),
                            os.path.join(install_folder, "package.json"),
                            os.path.join(install_folder, "info.json"),
                            os.path.join(install_folder, "manifest.json"),
                            os.path.join(install_folder, "README.md"),
                            os.path.join(install_folder, "README.txt")
                        ]
                        
                        for config_path in config_files:
                            if os.path.exists(config_path):
                                try:
                                    with open(config_path, 'r', encoding='utf-8') as f:
                                        if config_path.endswith('.json'):
                                            config_data = json.load(f)
                                            # 尝试从配置文件中提取标题和描述
                                            if "title" in config_data and config_data["title"]:
                                                item_info["title"] = config_data["title"]
                                            elif "name" in config_data and config_data["name"]:
                                                item_info["title"] = config_data["name"]
                                            
                                            if "description" in config_data and config_data["description"]:
                                                item_info["description"] = config_data["description"]
                                        else:
                                            # 对于文本文件，将第一行作为标题
                                            first_line = f.readline().strip()
                                            if first_line and item_info['title'].startswith('未知物品_'):
                                                item_info['title'] = first_line[:100]  # 限制长度
                                    logger.info(f"从本地文件 {os.path.basename(config_path)} 成功获取物品 {item_id} 的信息")
                                    break
                                except Exception as file_error:
                                    logger.warning(f"读取配置文件 {config_path} 时出错: {file_error}")
                # 移除了没有对应try块的except语句
                
                # 确保publishedFileId是字符串类型
                item_info['publishedFileId'] = str(item_info['publishedFileId'])
                
                # 尝试获取预览图信息 - 优先从本地文件夹查找
                preview_url = None
                install_folder = item_info.get('installedFolder')
                if install_folder and os.path.exists(install_folder):
                    try:
                        # 使用辅助函数查找预览图
                        preview_image_path = find_preview_image_in_folder(install_folder)
                        if preview_image_path:
                            # 为前端提供代理访问的路径格式
                            # 需要将路径标准化，确保可以通过proxy-image API访问
                            if os.name == 'nt':
                                # Windows路径处理
                                proxy_path = preview_image_path.replace('\\', '/')
                            else:
                                proxy_path = preview_image_path
                            preview_url = f"/api/proxy-image?image_path={quote(proxy_path)}"
                            logger.debug(f'为物品 {item_id} 找到本地预览图: {preview_url}')
                    except Exception as preview_error:
                        logger.warning(f'查找物品 {item_id} 预览图时出错: {preview_error}')
                
                # 添加预览图URL到物品信息
                if preview_url:
                    item_info['previewUrl'] = preview_url
                
                # 添加物品信息到结果列表
                items_info.append(item_info)
                logger.debug(f'物品 {item_id} 信息已添加到结果列表: {item_info["title"]}')
                
            except Exception as item_error:
                logger.error(f"获取物品 {item_id} 信息时出错: {item_error}")
                # 即使出错，也添加一个最基本的物品信息到列表中
                try:
                    basic_item_info = {
                        "publishedFileId": str(item_id),  # 确保是字符串类型
                        "title": f"未知物品_{item_id}",
                        "description": "无法获取详细信息",
                        "state": {
                            "subscribed": True,
                            "installed": False,
                            "downloading": False,
                            "needsUpdate": False,
                            "error": True
                        },
                        "error_message": str(item_error)
                    }
                    items_info.append(basic_item_info)
                    logger.info(f'已添加物品 {item_id} 的基本信息到结果列表')
                except Exception as basic_error:
                    logger.error(f"添加基本物品信息也失败了: {basic_error}")
                # 继续处理下一个物品
                continue
        
        return {
            "success": True,
            "items": items_info,
            "total": len(items_info)
        }
        
    except Exception as e:
        logger.error(f"获取订阅物品列表时出错: {e}")
        return JSONResponse({
            "success": False,
            "error": f"获取订阅物品失败: {str(e)}"
        }, status_code=500)

async def _init_and_mount_workshop():
    """
    初始化并挂载创意工坊目录
    
    设计原则：
    - main 层只负责调用，不维护状态
    - 路径由 utils 层计算并持久化到 config 层
    - 其他代码需要路径时调用 get_workshop_path() 获取
    """
    try:
        # 1. 获取订阅的创意工坊物品列表
        workshop_items_result = get_subscribed_workshop_items()
        
        # 2. 提取物品列表传给 utils 层
        subscribed_items = []
        if isinstance(workshop_items_result, dict) and workshop_items_result.get('success', False):
            subscribed_items = workshop_items_result.get('items', [])
        
        # 3. 调用 utils 层函数获取/计算路径（路径会被持久化到 config）
        workshop_path = get_workshop_root(subscribed_items)
        
        # 4. 挂载静态文件目录
        if workshop_path and os.path.exists(workshop_path) and os.path.isdir(workshop_path):
            try:
                app.mount("/workshop", StaticFiles(directory=workshop_path), name="workshop")
                logger.info(f"✅ 成功挂载创意工坊目录: {workshop_path}")
            except Exception as e:
                logger.error(f"挂载创意工坊目录失败: {e}")
        else:
            logger.warning(f"创意工坊目录不存在或不是有效的目录: {workshop_path}，跳过挂载")
    except Exception as e:
        logger.error(f"初始化创意工坊目录时出错: {e}")
        # 降级：确保至少有一个默认路径可用
        workshop_path = get_workshop_path()
        logger.info(f"使用配置中的默认路径: {workshop_path}")
        if workshop_path and os.path.exists(workshop_path) and os.path.isdir(workshop_path):
            try:
                app.mount("/workshop", StaticFiles(directory=workshop_path), name="workshop")
                logger.info(f"✅ 降级模式下成功挂载创意工坊目录: {workshop_path}")
            except Exception as mount_err:
                logger.error(f"降级模式挂载创意工坊目录仍然失败: {mount_err}")

@app.get('/api/steam/workshop/item/{item_id}')
async def get_workshop_item_details(item_id: str):
    """
    获取单个Steam创意工坊物品的详细信息
    """
    global steamworks
    
    # 检查Steamworks是否初始化成功
    if steamworks is None:
        return JSONResponse({
            "success": False,
            "error": "Steamworks未初始化",
            "message": "请确保Steam客户端已运行且已登录"
        }, status_code=503)
    
    try:
        # 转换item_id为整数
        item_id_int = int(item_id)
        
        # 获取物品状态
        item_state = steamworks.Workshop.GetItemState(item_id_int)
        
        # 创建查询请求，传入必要的published_file_ids参数
        query_handle = steamworks.Workshop.CreateQueryUGCDetailsRequest([item_id_int])
        
        # 发送查询请求
        # 注意：SendQueryUGCRequest返回None而不是布尔值
        steamworks.Workshop.SendQueryUGCRequest(query_handle)
        
        # 直接获取查询结果，不检查handle
        result = steamworks.Workshop.GetQueryUGCResult(query_handle, 0)
        
        if result:
            
            if result:
                # 获取物品安装信息 - 支持字典格式（根据workshop.py的实现）
                install_info = steamworks.Workshop.GetItemInstallInfo(item_id_int)
                installed = bool(install_info)
                folder = install_info.get('folder', '') if installed else ''
                size = 0
                disk_size = install_info.get('disk_size')
                if isinstance(disk_size, (int, float)):
                    size = int(disk_size)
                
                # 获取物品下载信息
                download_info = steamworks.Workshop.GetItemDownloadInfo(item_id_int)
                downloading = False
                bytes_downloaded = 0
                bytes_total = 0
                
                # 处理下载信息（使用正确的键名：downloaded和total）
                if download_info:
                    if isinstance(download_info, dict):
                        downloaded = int(download_info.get("downloaded", 0) or 0)
                        total = int(download_info.get("total", 0) or 0)
                        downloading = downloaded > 0 and downloaded < total
                        bytes_downloaded = downloaded
                        bytes_total = total
                    elif isinstance(download_info, tuple) and len(download_info) >= 3:
                        # 兼容元组格式
                        downloading, bytes_downloaded, bytes_total = download_info
                
                # 解码bytes类型的字段为字符串，避免JSON序列化错误
                title = result.title.decode('utf-8', errors='replace') if hasattr(result, 'title') and isinstance(result.title, bytes) else getattr(result, 'title', '')
                description = result.description.decode('utf-8', errors='replace') if hasattr(result, 'description') and isinstance(result.description, bytes) else getattr(result, 'description', '')
                
                # 构建详细的物品信息
                item_info = {
                    "publishedFileId": item_id_int,
                    "title": title,
                    "description": description,
                    "steamIDOwner": result.steamIDOwner,
                    "timeCreated": result.timeCreated,
                    "timeUpdated": result.timeUpdated,
                    "previewImageUrl": result.URL,  # 使用result.URL代替不存在的previewImageUrl
                    "fileUrl": result.URL,  # 使用result.URL代替不存在的fileUrl
                    "fileSize": result.fileSize,
                    "fileId": result.file,  # 使用result.file代替不存在的fileId
                    "previewFileId": result.previewFile,  # 使用result.previewFile代替不存在的previewFileId
                    # 移除不存在的appID属性
                    "tags": [],
                    "state": {
                        "subscribed": bool(item_state & 1),
                        "legacyItem": bool(item_state & 2),
                        "installed": installed,
                        "needsUpdate": bool(item_state & 8),
                        "downloading": downloading,
                        "downloadPending": bool(item_state & 32),
                        "isWorkshopItem": bool(item_state & 128)
                    },
                    "installedFolder": folder if installed else None,
                    "fileSizeOnDisk": size if installed else 0,
                    "downloadProgress": {
                        "bytesDownloaded": bytes_downloaded if downloading else 0,
                        "bytesTotal": bytes_total if downloading else 0,
                        "percentage": (bytes_downloaded / bytes_total * 100) if bytes_total > 0 and downloading else 0
                    }
                }
                
                # 注意：SteamWorkshop类中不存在ReleaseQueryUGCRequest方法，无需释放句柄
                
                return {
                    "success": True,
                    "item": item_info
                }
            else:
                # 注意：SteamWorkshop类中不存在ReleaseQueryUGCRequest方法
                return JSONResponse({
                    "success": False,
                    "error": "获取物品详情失败，未找到物品"
                }, status_code=404)
            
    except ValueError:
        return JSONResponse({
            "success": False,
            "error": "无效的物品ID"
        }, status_code=400)
    except Exception as e:
        logger.error(f"获取物品 {item_id} 详情时出错: {e}")
        return JSONResponse({
            "success": False,
            "error": f"获取物品详情失败: {str(e)}"
        }, status_code=500)

@app.post('/api/steam/workshop/unsubscribe')
async def unsubscribe_workshop_item(request: Request):
    """
    取消订阅Steam创意工坊物品
    接收包含物品ID的POST请求
    """
    global steamworks
    
    # 检查Steamworks是否初始化成功
    if steamworks is None:
        return JSONResponse({
            "success": False,
            "error": "Steamworks未初始化",
            "message": "请确保Steam客户端已运行且已登录"
        }, status_code=503)
    
    try:
        # 获取请求体中的数据
        data = await request.json()
        item_id = data.get('item_id')
        
        if not item_id:
            return JSONResponse({
                "success": False,
                "error": "缺少必要参数",
                "message": "请求中缺少物品ID"
            }, status_code=400)
        
        # 转换item_id为整数
        try:
            item_id_int = int(item_id)
        except ValueError:
            return JSONResponse({
                "success": False,
                "error": "无效的物品ID",
                "message": "提供的物品ID不是有效的数字"
            }, status_code=400)
        
        # 定义一个简单的回调函数来处理取消订阅的结果
        def unsubscribe_callback(result):
            # 记录取消订阅的结果
            if result.result == 1:  # k_EResultOK
                logger.info(f"取消订阅成功回调: {item_id_int}")
            else:
                logger.warning(f"取消订阅失败回调: {item_id_int}, 错误代码: {result.result}")
        
        # 调用Steamworks的UnsubscribeItem方法，并提供回调函数
        steamworks.Workshop.UnsubscribeItem(item_id_int, callback=unsubscribe_callback)
        # 由于回调是异步的，我们返回请求已被接受处理的状态
        logger.info(f"取消订阅请求已被接受，正在处理: {item_id_int}")
        return {
            "success": True,
            "status": "accepted",
            "message": "取消订阅请求已被接受，正在处理中。实际结果将在后台异步完成。"
        }
            
    except Exception as e:
        logger.error(f"取消订阅物品时出错: {e}")
        return JSONResponse({
            "success": False,
            "error": "服务器内部错误",
            "message": f"取消订阅过程中发生错误: {str(e)}"
        }, status_code=500)

@app.get('/api/characters/current_catgirl')
async def get_current_catgirl():
    """获取当前使用的猫娘名称"""
    characters = _config_manager.load_characters()
    current_catgirl = characters.get('当前猫娘', '')
    return JSONResponse(content={'current_catgirl': current_catgirl})

@app.get('/api/characters/catgirl/{name}/voice_mode_status')
async def get_catgirl_voice_mode_status(name: str):
    """检查指定角色是否在语音模式下"""
    characters = _config_manager.load_characters()
    is_current = characters.get('当前猫娘') == name
    
    if name not in session_manager:
        return JSONResponse({'is_voice_mode': False, 'is_current': is_current, 'is_active': False})
    
    mgr = session_manager[name]
    is_active = mgr.is_active if mgr else False
    
    is_voice_mode = False
    if is_active and mgr:
        # 检查是否是语音模式（通过session类型判断）
        from main_helper.omni_realtime_client import OmniRealtimeClient
        is_voice_mode = mgr.session and isinstance(mgr.session, OmniRealtimeClient)
    
    return JSONResponse({
        'is_voice_mode': is_voice_mode,
        'is_current': is_current,
        'is_active': is_active
    })

@app.post('/api/characters/current_catgirl')
async def set_current_catgirl(request: Request):
    """设置当前使用的猫娘"""
    data = await request.json()
    catgirl_name = data.get('catgirl_name', '') if data else ''
    
    if not catgirl_name:
        return JSONResponse({'success': False, 'error': '猫娘名称不能为空'}, status_code=400)
    
    characters = _config_manager.load_characters()
    if catgirl_name not in characters.get('猫娘', {}):
        return JSONResponse({'success': False, 'error': '指定的猫娘不存在'}, status_code=404)
    
    old_catgirl = characters.get('当前猫娘', '')
    
    # 检查当前角色是否有活跃的语音session
    if old_catgirl and old_catgirl in session_manager:
        mgr = session_manager[old_catgirl]
        if mgr.is_active:
            # 检查是否是语音模式（通过session类型判断）
            from main_helper.omni_realtime_client import OmniRealtimeClient
            is_voice_mode = mgr.session and isinstance(mgr.session, OmniRealtimeClient)
            
            if is_voice_mode:
                return JSONResponse({
                    'success': False, 
                    'error': '语音状态下无法切换角色，请先停止语音对话后再切换'
                }, status_code=400)
    characters['当前猫娘'] = catgirl_name
    _config_manager.save_characters(characters)
    # 自动重新加载配置
    await initialize_character_data()
    
    # 通过WebSocket通知所有连接的客户端
    # 使用session_manager中的websocket，但需要确保websocket已设置
    notification_count = 0
    logger.info(f"开始通知WebSocket客户端：猫娘从 {old_catgirl} 切换到 {catgirl_name}")
    
    message = json.dumps({
        "type": "catgirl_switched",
        "new_catgirl": catgirl_name,
        "old_catgirl": old_catgirl
    })
    
    # 遍历所有session_manager，尝试发送消息
    for lanlan_name, mgr in session_manager.items():
        ws = mgr.websocket
        logger.info(f"检查 {lanlan_name} 的WebSocket: websocket存在={ws is not None}")
        
        if ws:
            try:
                await ws.send_text(message)
                notification_count += 1
                logger.info(f"✅ 已通过WebSocket通知 {lanlan_name} 的连接：猫娘已从 {old_catgirl} 切换到 {catgirl_name}")
            except Exception as e:
                logger.warning(f"❌ 通知 {lanlan_name} 的连接失败: {e}")
                # 如果发送失败，可能是连接已断开，清空websocket引用
                if mgr.websocket == ws:
                    mgr.websocket = None
    
    if notification_count > 0:
        logger.info(f"✅ 已通过WebSocket通知 {notification_count} 个连接的客户端：猫娘已从 {old_catgirl} 切换到 {catgirl_name}")
    else:
        logger.warning(f"⚠️ 没有找到任何活跃的WebSocket连接来通知猫娘切换")
        logger.warning(f"提示：请确保前端页面已打开并建立了WebSocket连接，且已调用start_session")
    
    return {"success": True}

# 以下路由已移至 main_routers/characters_router.py，通过 app.include_router(characters_router) 挂载
# 删除重复的路由定义以避免冲突
# 以下路由已移至 main_routers/characters_router.py，通过 app.include_router(characters_router) 挂载
# 删除重复的路由定义以避免冲突
    data = await request.json()
    if not data:
        return JSONResponse({'success': False, 'error': '无数据'}, status_code=400)
    characters = _config_manager.load_characters()
    if name not in characters.get('猫娘', {}):
        return JSONResponse({'success': False, 'error': '猫娘不存在'}, status_code=404)
    
    # 记录更新前的voice_id，用于检测是否变更
    old_voice_id = characters['猫娘'][name].get('voice_id', '')
    
    # 如果包含voice_id，验证其有效性
    if 'voice_id' in data:
        voice_id = data['voice_id']
        # 空字符串表示删除voice_id，跳过验证
        if voice_id != '' and not _config_manager.validate_voice_id(voice_id):
            voices = _config_manager.get_voices_for_current_api()
            available_voices = list(voices.keys())
            return JSONResponse({
                'success': False, 
                'error': f'voice_id "{voice_id}" 在当前API的音色库中不存在',
                'available_voices': available_voices
            }, status_code=400)
    
    # 只更新前端传来的字段，未传字段保留原值，且不允许通过此接口修改 system_prompt
    removed_fields = []
    for k, v in characters['猫娘'][name].items():
        if k not in data and k not in ('档案名', 'system_prompt', 'voice_id', 'live2d'):
            removed_fields.append(k)
    for k in removed_fields:
        characters['猫娘'][name].pop(k)
    
    # 处理voice_id的特殊逻辑：如果传入空字符串，则删除该字段
    if 'voice_id' in data and data['voice_id'] == '':
        characters['猫娘'][name].pop('voice_id', None)
    
    # 更新其他字段
    for k, v in data.items():
        if k not in ('档案名', 'voice_id') and v:
            characters['猫娘'][name][k] = v
        elif k == 'voice_id' and v:  # voice_id非空时才更新
            characters['猫娘'][name][k] = v
    _config_manager.save_characters(characters)
    
    # 获取更新后的voice_id
    new_voice_id = characters['猫娘'][name].get('voice_id', '')
    voice_id_changed = (old_voice_id != new_voice_id)
    
    # 如果是当前活跃的猫娘且voice_id发生了变更，需要先通知前端，再关闭session
    is_current_catgirl = (name == characters.get('当前猫娘', ''))
    session_ended = False
    
    if voice_id_changed and is_current_catgirl and name in session_manager:
        # 检查是否有活跃的session
        if session_manager[name].is_active:
            logger.info(f"检测到 {name} 的voice_id已变更（{old_voice_id} -> {new_voice_id}），准备刷新...")
            
            # 1. 先发送刷新消息（WebSocket还连着）
            if session_manager[name].websocket:
                try:
                    await session_manager[name].websocket.send_text(json.dumps({
                        "type": "reload_page",
                        "message": "语音已更新，页面即将刷新"
                    }))
                    logger.info(f"已通知 {name} 的前端刷新页面")
                except Exception as e:
                    logger.warning(f"通知前端刷新页面失败: {e}")
            
            # 2. 立刻关闭session（这会断开WebSocket）
            try:
                await session_manager[name].end_session(by_server=True)
                session_ended = True
                logger.info(f"{name} 的session已结束")
            except Exception as e:
                logger.error(f"结束session时出错: {e}")
    
    # 方案3：条件性重新加载 - 只有当前猫娘或voice_id变更时才重新加载配置
    if voice_id_changed and is_current_catgirl:
        # 自动重新加载配置
        await initialize_character_data()
        logger.info(f"配置已重新加载，新的voice_id已生效")
    elif voice_id_changed and not is_current_catgirl:
        # 不是当前猫娘，跳过重新加载，避免影响当前猫娘的session
        logger.info(f"切换的是其他猫娘 {name} 的音色，跳过重新加载以避免影响当前猫娘的session")
    
    return {"success": True, "voice_id_changed": voice_id_changed, "session_restarted": session_ended}

@app.put('/api/characters/catgirl/vrm/{name}')
async def update_catgirl_vrm(name: str, request: Request):
    """更新指定猫娘的VRM模型设置"""
    try:
        data = await request.json()
        vrm_model = data.get('vrm')
        
        if not vrm_model:
            return JSONResponse(content={
                'success': False,
                'error': '未提供VRM模型名称'
            })
        
        # 加载当前角色配置
        characters = _config_manager.load_characters()
        
        # 确保猫娘配置存在
        if '猫娘' not in characters:
            characters['猫娘'] = {}
        
        # 确保指定猫娘的配置存在
        if name not in characters['猫娘']:
            characters['猫娘'][name] = {}
        
        # 更新VRM模型设置
        characters['猫娘'][name]['vrm'] = vrm_model
        
        # 保存配置
        _config_manager.save_characters(characters)
        # 自动重新加载配置
        await initialize_character_data()
        
        return JSONResponse(content={
            'success': True,
            'message': f'已更新角色 {name} 的VRM模型为 {vrm_model}'
        })
        
    except Exception as e:
        logger.error(f"更新角色VRM模型失败: {e}")
        return JSONResponse(content={
            'success': False,
            'error': str(e)
        })

@app.put('/api/characters/catgirl/voice_id/{name}')
async def update_catgirl_voice_id(name: str, request: Request):
    data = await request.json()
    if not data:
        return JSONResponse({'success': False, 'error': '无数据'}, status_code=400)
    characters = _config_manager.load_characters()
    if name not in characters.get('猫娘', {}):
        return JSONResponse({'success': False, 'error': '猫娘不存在'}, status_code=404)
    if 'voice_id' in data:
        voice_id = data['voice_id']
        # 验证voice_id是否在voice_storage中
        if not _config_manager.validate_voice_id(voice_id):
            voices = _config_manager.get_voices_for_current_api()
            available_voices = list(voices.keys())
            return JSONResponse({
                'success': False, 
                'error': f'voice_id "{voice_id}" 在当前API的音色库中不存在',
                'available_voices': available_voices
            }, status_code=400)
        characters['猫娘'][name]['voice_id'] = voice_id
    _config_manager.save_characters(characters)
    
    # 如果是当前活跃的猫娘，需要先通知前端，再关闭session
    is_current_catgirl = (name == characters.get('当前猫娘', ''))
    session_ended = False
    
    if is_current_catgirl and name in session_manager:
        # 检查是否有活跃的session
        if session_manager[name].is_active:
            logger.info(f"检测到 {name} 的voice_id已更新，准备刷新...")
            
            # 1. 先发送刷新消息（WebSocket还连着）
            if session_manager[name].websocket:
                try:
                    await session_manager[name].websocket.send_text(json.dumps({
                        "type": "reload_page",
                        "message": "语音已更新，页面即将刷新"
                    }))
                    logger.info(f"已通知 {name} 的前端刷新页面")
                except Exception as e:
                    logger.warning(f"通知前端刷新页面失败: {e}")
            
            # 2. 立刻关闭session（这会断开WebSocket）
            try:
                await session_manager[name].end_session(by_server=True)
                session_ended = True
                logger.info(f"{name} 的session已结束")
            except Exception as e:
                logger.error(f"结束session时出错: {e}")
    
    # 方案3：条件性重新加载 - 只有当前猫娘才重新加载配置
    if is_current_catgirl:
        # 3. 重新加载配置，让新的voice_id生效
        await initialize_character_data()
        logger.info(f"配置已重新加载，新的voice_id已生效")
    else:
        # 不是当前猫娘，跳过重新加载，避免影响当前猫娘的session
        logger.info(f"切换的是其他猫娘 {name} 的音色，跳过重新加载以避免影响当前猫娘的session")
    
    return {"success": True, "session_restarted": session_ended}

@app.post('/api/characters/clear_voice_ids')
async def clear_voice_ids():
    """清除所有角色的本地Voice ID记录"""
    try:
        characters = _config_manager.load_characters()
        cleared_count = 0
        
        # 清除所有猫娘的voice_id
        if '猫娘' in characters:
            for name in characters['猫娘']:
                if 'voice_id' in characters['猫娘'][name] and characters['猫娘'][name]['voice_id']:
                    characters['猫娘'][name]['voice_id'] = ''
                    cleared_count += 1
        
        _config_manager.save_characters(characters)
        # 自动重新加载配置
        await initialize_character_data()
        
        return JSONResponse({
            'success': True, 
            'message': f'已清除 {cleared_count} 个角色的Voice ID记录',
            'cleared_count': cleared_count
        })
    except Exception as e:
        return JSONResponse({
            'success': False, 
            'error': f'清除Voice ID记录时出错: {str(e)}'
        }, status_code=500)

@app.post('/api/characters/set_microphone')
async def set_microphone(request: Request):
    try:
        data = await request.json()
        microphone_id = data.get('microphone_id')
        
        # 使用标准的load/save函数
        characters_data = _config_manager.load_characters()
        
        # 添加或更新麦克风选择
        characters_data['当前麦克风'] = microphone_id
        
        # 保存配置
        _config_manager.save_characters(characters_data)
        # 自动重新加载配置
        await initialize_character_data()
        
        return {"success": True}
    except Exception as e:
        logger.error(f"保存麦克风选择失败: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get('/api/characters/get_microphone')
async def get_microphone():
    try:
        # 使用配置管理器加载角色配置
        characters_data = _config_manager.load_characters()
        
        # 获取保存的麦克风选择
        microphone_id = characters_data.get('当前麦克风')
        
        return {"microphone_id": microphone_id}
    except Exception as e:
        logger.error(f"获取麦克风选择失败: {e}")
        return {"microphone_id": None}

@app.post('/api/voice_clone')
async def voice_clone(file: UploadFile = File(...), prefix: str = Form(...)):
    # 直接读取到内存
    try:
        file_content = await file.read()
        file_buffer = io.BytesIO(file_content)
    except Exception as e:
        logger.error(f"读取文件到内存失败: {e}")
        return JSONResponse({'error': f'读取文件失败: {e}'}, status_code=500)


    def validate_audio_file(file_buffer: io.BytesIO, filename: str) -> tuple[str, str]:
        """
        验证音频文件类型和格式
        返回: (mime_type, error_message)
        """
        file_path_obj = pathlib.Path(filename)
        file_extension = file_path_obj.suffix.lower()
        
        # 检查文件扩展名
        if file_extension not in ['.wav', '.mp3', '.m4a']:
            return "", f"不支持的文件格式: {file_extension}。仅支持 WAV、MP3 和 M4A 格式。"
        
        # 根据扩展名确定MIME类型
        if file_extension == '.wav':
            mime_type = "audio/wav"
            # 检查WAV文件是否为16bit
            try:
                file_buffer.seek(0)
                with wave.open(file_buffer, 'rb') as wav_file:
                    # 检查采样宽度（bit depth）
                    if wav_file.getsampwidth() != 2:  # 2 bytes = 16 bits
                        return "", f"WAV文件必须是16bit格式，当前文件是{wav_file.getsampwidth() * 8}bit。"
                    
                    # 检查声道数（建议单声道）
                    channels = wav_file.getnchannels()
                    if channels > 1:
                        return "", f"建议使用单声道WAV文件，当前文件有{channels}个声道。"
                    
                    # 检查采样率
                    sample_rate = wav_file.getframerate()
                    if sample_rate not in [8000, 16000, 22050, 44100, 48000]:
                        return "", f"建议使用标准采样率(8000, 16000, 22050, 44100, 48000)，当前文件采样率: {sample_rate}Hz。"
                file_buffer.seek(0)
            except Exception as e:
                return "", f"WAV文件格式错误: {str(e)}。请确认您的文件是合法的WAV文件。"
                
        elif file_extension == '.mp3':
            mime_type = "audio/mpeg"
            try:
                file_buffer.seek(0)
                # 读取更多字节以支持不同的MP3格式
                header = file_buffer.read(32)
                file_buffer.seek(0)

                # 检查文件大小是否合理
                file_size = len(file_buffer.getvalue())
                if file_size < 1024:  # 至少1KB
                    return "", "MP3文件太小，可能不是有效的音频文件。"
                if file_size > 1024 * 1024 * 10:  # 10MB
                    return "", "MP3文件太大，可能不是有效的音频文件。"
                
                # 更宽松的MP3文件头检查
                # MP3文件通常以ID3标签或帧同步字开头
                # 检查是否以ID3标签开头 (ID3v2)
                has_id3_header = header.startswith(b'ID3')
                # 检查是否有帧同步字 (FF FA, FF FB, FF F2, FF F3, FF E3等)
                has_frame_sync = False
                for i in range(len(header) - 1):
                    if header[i] == 0xFF and (header[i+1] & 0xE0) == 0xE0:
                        has_frame_sync = True
                        break
                
                # 如果既没有ID3标签也没有帧同步字，则认为文件可能无效
                # 但这只是一个警告，不应该严格拒绝
                if not has_id3_header and not has_frame_sync:
                    return mime_type, "警告: MP3文件可能格式不标准，文件头: {header[:4].hex()}"
                        
            except Exception as e:
                return "", f"MP3文件读取错误: {str(e)}。请确认您的文件是合法的MP3文件。"
                
        elif file_extension == '.m4a':
            mime_type = "audio/mp4"
            try:
                file_buffer.seek(0)
                # 读取文件头来验证M4A格式
                header = file_buffer.read(32)
                file_buffer.seek(0)
                
                # M4A文件应该以'ftyp'盒子开始，通常在偏移4字节处
                # 检查是否包含'ftyp'标识
                if b'ftyp' not in header:
                    return "", "M4A文件格式无效或已损坏。请确认您的文件是合法的M4A文件。"
                
                # 进一步验证：检查是否包含常见的M4A类型标识
                # M4A通常包含'mp4a', 'M4A ', 'M4V '等类型
                valid_types = [b'mp4a', b'M4A ', b'M4V ', b'isom', b'iso2', b'avc1']
                has_valid_type = any(t in header for t in valid_types)
                
                if not has_valid_type:
                    return mime_type,  "警告: M4A文件格式无效或已损坏。请确认您的文件是合法的M4A文件。"
                        
            except Exception as e:
                return "", f"M4A文件读取错误: {str(e)}。请确认您的文件是合法的M4A文件。"
        
        return mime_type, ""

    try:
        # 1. 验证音频文件
        mime_type, error_msg = validate_audio_file(file_buffer, file.filename)
        if not mime_type:
            return JSONResponse({'error': error_msg}, status_code=400)
        
        # 检查文件大小（tfLink支持最大100MB）
        file_size = len(file_content)
        if file_size > 100 * 1024 * 1024:  # 100MB
            return JSONResponse({'error': '文件大小超过100MB，超过tfLink的限制'}, status_code=400)
        
        # 2. 上传到 tfLink - 直接使用内存中的内容
        file_buffer.seek(0)
        # 根据tfLink API文档，使用multipart/form-data上传文件
        # 参数名应为'file'
        files = {'file': (file.filename, file_buffer, mime_type)}
        
        # 添加更多的请求头，确保兼容性
        headers = {
            'Accept': 'application/json'
        }
        
        logger.info(f"正在上传文件到tfLink，文件名: {file.filename}, 大小: {file_size} bytes, MIME类型: {mime_type}")
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post('http://47.101.214.205:8000/api/upload', files=files, headers=headers)

            # 检查响应状态
            if resp.status_code != 200:
                logger.error(f"上传到tfLink失败，状态码: {resp.status_code}, 响应内容: {resp.text}")
                return JSONResponse({'error': f'上传到tfLink失败，状态码: {resp.status_code}, 详情: {resp.text[:200]}'}, status_code=500)
            
            try:
                # 解析JSON响应
                data = resp.json()
                logger.info(f"tfLink原始响应: {data}")
                
                # 获取下载链接
                tmp_url = None
                possible_keys = ['downloadLink', 'download_link', 'url', 'direct_link', 'link', 'download_url']
                for key in possible_keys:
                    if key in data:
                        tmp_url = data[key]
                        logger.info(f"找到下载链接键: {key}")
                        break
                
                if not tmp_url:
                    logger.error(f"无法从响应中提取URL: {data}")
                    return JSONResponse({'error': f'上传成功但无法从响应中提取URL'}, status_code=500)
                
                # 确保URL有效
                if not tmp_url.startswith(('http://', 'https://')):
                    logger.error(f"无效的URL格式: {tmp_url}")
                    return JSONResponse({'error': f'无效的URL格式: {tmp_url}'}, status_code=500)
                    
                # 测试URL是否可访问
                test_resp = await client.head(tmp_url, timeout=10)
                if test_resp.status_code >= 400:
                    logger.error(f"生成的URL无法访问: {tmp_url}, 状态码: {test_resp.status_code}")
                    return JSONResponse({'error': f'生成的临时URL无法访问，请重试'}, status_code=500)
                    
                logger.info(f"成功获取临时URL并验证可访问性: {tmp_url}")
                
            except ValueError:
                raw_text = resp.text
                logger.error(f"上传成功但响应格式无法解析: {raw_text}")
                return JSONResponse({'error': f'上传成功但响应格式无法解析: {raw_text[:200]}'}, status_code=500)
        
        # 3. 用直链注册音色
        core_config = _config_manager.get_core_config()
        audio_api_key = core_config.get('AUDIO_API_KEY')
        
        if not audio_api_key:
            logger.error("未配置 AUDIO_API_KEY")
            return JSONResponse({
                'error': '未配置音频API密钥，请在设置中配置AUDIO_API_KEY',
                'suggestion': '请前往设置页面配置音频API密钥'
            }, status_code=400)
        
        dashscope.api_key = audio_api_key
        service = VoiceEnrollmentService()
        target_model = "cosyvoice-v3-plus"
        
        # 重试配置
        max_retries = 3
        retry_delay = 3  # 重试前等待的秒数
        
        for attempt in range(max_retries):
            try:
                logger.info(f"开始音色注册（尝试 {attempt + 1}/{max_retries}），使用URL: {tmp_url}")
                
                # 尝试执行音色注册
                voice_id = service.create_voice(target_model=target_model, prefix=prefix, url=tmp_url)
                    
                logger.info(f"音色注册成功，voice_id: {voice_id}")
                voice_data = {
                    'voice_id': voice_id,
                    'prefix': prefix,
                    'file_url': tmp_url,
                    'created_at': datetime.now().isoformat()
                }
                try:
                    _config_manager.save_voice_for_current_api(voice_id, voice_data)
                    logger.info(f"voice_id已保存到音色库: {voice_id}")
                    
                    # 验证voice_id是否能够被正确读取（添加短暂延迟，避免文件系统延迟）
                    await asyncio.sleep(0.1)  # 等待100ms，确保文件写入完成
                    
                    # 最多验证3次，每次间隔100ms
                    validation_success = False
                    for validation_attempt in range(3):
                        if _config_manager.validate_voice_id(voice_id):
                            validation_success = True
                            logger.info(f"voice_id保存验证成功: {voice_id} (尝试 {validation_attempt + 1})")
                            break
                        if validation_attempt < 2:
                            await asyncio.sleep(0.1)
                    
                    if not validation_success:
                        logger.warning(f"voice_id保存后验证失败，但可能已成功保存: {voice_id}")
                        # 不返回错误，因为保存可能已成功，只是验证失败
                        # 继续返回成功，让用户尝试使用
                    
                except Exception as save_error:
                    logger.error(f"保存voice_id到音色库失败: {save_error}")
                    return JSONResponse({
                        'error': f'音色注册成功但保存到音色库失败: {str(save_error)}',
                        'voice_id': voice_id,
                        'file_url': tmp_url
                    }, status_code=500)
                    
                return JSONResponse({
                    'voice_id': voice_id,
                    'request_id': service.get_last_request_id(),
                    'file_url': tmp_url,
                    'message': '音色注册成功并已保存到音色库'
                })
                
            except Exception as e:
                logger.error(f"音色注册失败（尝试 {attempt + 1}/{max_retries}）: {str(e)}")
                error_detail = str(e)
                
                # 检查是否是超时错误
                is_timeout = ("ResponseTimeout" in error_detail or 
                             "response timeout" in error_detail.lower() or
                             "timeout" in error_detail.lower())
                
                # 检查是否是文件下载失败错误
                is_download_failed = ("download audio failed" in error_detail or 
                                     "415" in error_detail)
                
                # 如果是超时或下载失败，且还有重试机会，则重试
                if (is_timeout or is_download_failed) and attempt < max_retries - 1:
                    logger.warning(f"检测到{'超时' if is_timeout else '文件下载失败'}错误，等待 {retry_delay} 秒后重试...")
                    await asyncio.sleep(retry_delay)
                    continue  # 重试
                
                # 如果是最后一次尝试或非可重试错误，返回错误
                if is_timeout:
                    return JSONResponse({
                        'error': f'音色注册超时，已尝试{max_retries}次',
                        'detail': error_detail,
                        'file_url': tmp_url,
                        'suggestion': '请检查您的网络连接，或稍后再试。如果问题持续，可能是服务器繁忙。'
                    }, status_code=408)
                elif is_download_failed:
                    return JSONResponse({
                        'error': f'音色注册失败: 无法下载音频文件，已尝试{max_retries}次',
                        'detail': error_detail,
                        'file_url': tmp_url,
                        'suggestion': '请检查文件URL是否可访问，或稍后重试'
                    }, status_code=415)
                else:
                    # 其他错误直接返回
                    return JSONResponse({
                        'error': f'音色注册失败: {error_detail}',
                        'file_url': tmp_url,
                        'attempt': attempt + 1,
                        'max_retries': max_retries
                    }, status_code=500)
    except Exception as e:
        # 确保tmp_url在出现异常时也有定义
        tmp_url = locals().get('tmp_url', '未获取到URL')
        logger.error(f"注册音色时发生未预期的错误: {str(e)}")
        return JSONResponse({'error': f'注册音色时发生错误: {str(e)}', 'file_url': tmp_url}, status_code=500)

@app.get('/api/voices')
async def get_voices():
    """获取当前API key对应的所有已注册音色"""
    return {"voices": _config_manager.get_voices_for_current_api()}

@app.post('/api/voices')
async def register_voice(request: Request):
    """注册新音色"""
    try:
        data = await request.json()
        voice_id = data.get('voice_id')
        voice_data = data.get('voice_data')
        
        if not voice_id or not voice_data:
            return JSONResponse({
                'success': False,
                'error': '缺少必要参数'
            }, status_code=400)
        
        # 准备音色数据
        complete_voice_data = {
            **voice_data,
            'voice_id': voice_id,
            'created_at': datetime.now().isoformat()
        }
        
        try:
            _config_manager.save_voice_for_current_api(voice_id, complete_voice_data)
        except Exception as e:
            logger.warning(f"保存音色配置失败: {e}")
            return JSONResponse({
                'success': False,
                'error': f'保存音色配置失败: {str(e)}'
            }, status_code=500)
            
        return {"success": True, "message": "音色注册成功"}
    except Exception as e:
        return JSONResponse({
            'success': False,
            'error': str(e)
        }, status_code=500)

@app.delete('/api/characters/catgirl/{name}')
async def delete_catgirl(name: str):
    import shutil
    
    characters = _config_manager.load_characters()
    if name not in characters.get('猫娘', {}):
        return JSONResponse({'success': False, 'error': '猫娘不存在'}, status_code=404)
    
    # 检查是否是当前正在使用的猫娘
    current_catgirl = characters.get('当前猫娘', '')
    if name == current_catgirl:
        return JSONResponse({'success': False, 'error': '不能删除当前正在使用的猫娘！请先切换到其他猫娘后再删除。'}, status_code=400)
    
    # 删除对应的记忆文件
    try:
        memory_paths = [_config_manager.memory_dir, _config_manager.project_memory_dir]
        files_to_delete = [
            f'semantic_memory_{name}',  # 语义记忆目录
            f'time_indexed_{name}',     # 时间索引数据库文件
            f'settings_{name}.json',    # 设置文件
            f'recent_{name}.json',      # 最近聊天记录文件
        ]
        
        for base_dir in memory_paths:
            for file_name in files_to_delete:
                file_path = base_dir / file_name
                if file_path.exists():
                    try:
                        if file_path.is_dir():
                            shutil.rmtree(file_path)
                        else:
                            file_path.unlink()
                        logger.info(f"已删除: {file_path}")
                    except Exception as e:
                        logger.warning(f"删除失败 {file_path}: {e}")
    except Exception as e:
        logger.error(f"删除记忆文件时出错: {e}")
    
    # 删除角色配置
    del characters['猫娘'][name]
    _config_manager.save_characters(characters)
    await initialize_character_data()
    return {"success": True}

async def shutdown_server_async():
    """异步关闭服务器"""
    try:
        # Give a small delay to allow the beacon response to be sent
        await asyncio.sleep(0.5)
        logger.info("正在关闭服务器...")
        
        # 向memory_server发送关闭信号
        try:
            from config import MEMORY_SERVER_PORT
            shutdown_url = f"http://localhost:{MEMORY_SERVER_PORT}/shutdown"
            async with httpx.AsyncClient(timeout=1) as client:
                response = await client.post(shutdown_url)
                if response.status_code == 200:
                    logger.info("已向memory_server发送关闭信号")
                else:
                    logger.warning(f"向memory_server发送关闭信号失败，状态码: {response.status_code}")
        except Exception as e:
            logger.warning(f"向memory_server发送关闭信号时出错: {e}")
        
        # Signal the server to stop
        current_config = get_start_config()
        if current_config['server'] is not None:
            current_config['server'].should_exit = True
    except Exception as e:
        logger.error(f"关闭服务器时出错: {e}")


# Steam 创意工坊管理相关API路由
# 确保这个路由被正确注册
if _IS_MAIN_PROCESS:
    logger.info('注册Steam创意工坊扫描API路由')


def _format_size(size_bytes):
    """
    将字节大小格式化为人类可读的格式
    """
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"



# 辅助函数
def get_folder_size(folder_path):
    """获取文件夹大小（字节）"""
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(folder_path):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            try:
                total_size += os.path.getsize(filepath)
            except (OSError, FileNotFoundError):
                continue
    return total_size

def find_preview_image_in_folder(folder_path):
    """在文件夹中查找预览图片，只查找指定的8个图片名称"""
    # 按优先级顺序查找指定的图片文件列表
    preview_image_names = ['preview.jpg', 'preview.png', 'thumbnail.jpg', 'thumbnail.png', 
                         'icon.jpg', 'icon.png', 'header.jpg', 'header.png']
    
    for image_name in preview_image_names:
        image_path = os.path.join(folder_path, image_name)
        if os.path.exists(image_path) and os.path.isfile(image_path):
            return image_path
    
    # 如果找不到指定的图片名称，返回None
    return None

@app.get('/live2d_emotion_manager', response_class=HTMLResponse)
async def live2d_emotion_manager(request: Request):
    """Live2D情感映射管理器页面"""
    try:
        template_path = os.path.join(_get_app_root(), 'templates', 'live2d_emotion_manager.html')
        with open(template_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return HTMLResponse(content=content)
    except Exception as e:
        logger.error(f"加载Live2D情感映射管理器页面失败: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get('/api/live2d/emotion_mapping/{model_name}')
async def get_emotion_mapping(model_name: str):
    """获取情绪映射配置"""
    try:
        # 查找模型目录（可能在static或用户文档目录）
        model_dir, url_prefix = find_model_directory(model_name)
        if not os.path.exists(model_dir):
            return JSONResponse(status_code=404, content={"success": False, "error": "模型目录不存在"})
        
        # 查找.model3.json文件
        model_json_path = None
        for file in os.listdir(model_dir):
            if file.endswith('.model3.json'):
                model_json_path = os.path.join(model_dir, file)
                break
        
        if not model_json_path or not os.path.exists(model_json_path):
            return JSONResponse(status_code=404, content={"success": False, "error": "模型配置文件不存在"})
        
        with open(model_json_path, 'r', encoding='utf-8') as f:
            config_data = json.load(f)

        # 优先使用 EmotionMapping；若不存在则从 FileReferences 推导
        emotion_mapping = config_data.get('EmotionMapping')
        if not emotion_mapping:
            derived_mapping = {"motions": {}, "expressions": {}}
            file_refs = config_data.get('FileReferences', {}) or {}

            # 从标准 Motions 结构推导
            motions = file_refs.get('Motions', {}) or {}
            for group_name, items in motions.items():
                files = []
                for item in items or []:
                    try:
                        file_path = item.get('File') if isinstance(item, dict) else None
                        if file_path:
                            files.append(file_path.replace('\\', '/'))
                    except Exception:
                        continue
                derived_mapping["motions"][group_name] = files

            # 从标准 Expressions 结构推导（按 Name 的前缀进行分组，如 happy_xxx）
            expressions = file_refs.get('Expressions', []) or []
            for item in expressions:
                if not isinstance(item, dict):
                    continue
                name = item.get('Name') or ''
                file_path = item.get('File') or ''
                if not file_path:
                    continue
                file_path = file_path.replace('\\', '/')
                # 根据第一个下划线拆分分组
                if '_' in name:
                    group = name.split('_', 1)[0]
                else:
                    # 无前缀的归入 neutral 组，避免丢失
                    group = 'neutral'
                derived_mapping["expressions"].setdefault(group, []).append(file_path)

            emotion_mapping = derived_mapping
        
        return {"success": True, "config": emotion_mapping}
    except Exception as e:
        logger.error(f"获取情绪映射配置失败: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post('/api/live2d/upload_model')
async def upload_live2d_model(files: list[UploadFile] = File(...)):
    """上传Live2D模型到用户文档目录"""
    import shutil
    import tempfile
    import zipfile
    
    try:
        if not files:
            return JSONResponse(status_code=400, content={"success": False, "error": "没有上传文件"})
        
        # 创建临时目录来处理上传的文件
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = pathlib.Path(temp_dir)
            
            # 保存所有上传的文件到临时目录，保持目录结构
            for file in files:
                # 从文件的相对路径中提取目录结构
                file_path = file.filename
                # 确保路径安全，移除可能的危险路径字符
                file_path = file_path.replace('\\', '/').lstrip('/')
                
                target_file_path = temp_path / file_path
                target_file_path.parent.mkdir(parents=True, exist_ok=True)
                
                # 保存文件
                with open(target_file_path, 'wb') as f:
                    content = await file.read()
                    f.write(content)
            
            # 在临时目录中递归查找.model3.json文件
            model_json_files = list(temp_path.rglob('*.model3.json'))
            
            if not model_json_files:
                return JSONResponse(status_code=400, content={"success": False, "error": "未找到.model3.json文件"})
            
            if len(model_json_files) > 1:
                return JSONResponse(status_code=400, content={"success": False, "error": "上传的文件中包含多个.model3.json文件"})
            
            model_json_file = model_json_files[0]
            
            # 确定模型根目录（.model3.json文件的父目录）
            model_root_dir = model_json_file.parent
            model_name = model_root_dir.name
            
            # 获取用户文档的live2d目录
            config_mgr = get_config_manager()
            config_mgr.ensure_live2d_directory()
            user_live2d_dir = config_mgr.live2d_dir
            
            # 目标目录
            target_model_dir = user_live2d_dir / model_name
            
            # 如果目标目录已存在，返回错误或覆盖（这里选择返回错误）
            if target_model_dir.exists():
                return JSONResponse(status_code=400, content={
                    "success": False, 
                    "error": f"模型 {model_name} 已存在，请先删除或重命名现有模型"
                })
            
            # 复制模型根目录到用户文档的live2d目录
            shutil.copytree(model_root_dir, target_model_dir)

            # 上传后：遍历模型目录中的所有动作文件（*.motion3.json），
            # 将官方白名单参数及模型自身在 .model3.json 中声明为 LipSync 的参数的 Segments 清空为 []。
            # 这样可以兼顾官方参数与模型声明的口型参数，同时忽略未声明的作者自定义命名（避免误伤）。
            try:
                import json as _json

                # 官方口型参数白名单（尽量全面列出常见和官方命名的嘴部/口型相关参数）
                # 仅包含与嘴巴形状、发音帧（A/I/U/E/O）、下颚/唇动作直接相关的参数，
                # 明确排除头部/身体/表情等其它参数（例如 ParamAngleZ、ParamAngleX 等不应在此）。
                official_mouth_params = {
                    # 五个基本发音帧（A/I/U/E/O）
                    'ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO',
                    # 常见嘴部上下/开合/形状参数
                    'ParamMouthUp', 'ParamMouthDown', 'ParamMouthOpen', 'ParamMouthOpenY',
                    'ParamMouthForm', 'ParamMouthX', 'ParamMouthY', 'ParamMouthSmile', 'ParamMouthPucker',
                    'ParamMouthStretch', 'ParamMouthShrug', 'ParamMouthLeft', 'ParamMouthRight',
                    'ParamMouthCornerUpLeft', 'ParamMouthCornerUpRight',
                    'ParamMouthCornerDownLeft', 'ParamMouthCornerDownRight',
                    # 唇相关（部分模型/官方扩展中可能出现）
                    'ParamLipA', 'ParamLipI', 'ParamLipU', 'ParamLipE', 'ParamLipO', 'ParamLipThickness',
                    # 下颚（部分模型以下颚控制口型）
                    'ParamJawOpen', 'ParamJawForward', 'ParamJawLeft', 'ParamJawRight',
                    # 其它口型相关（保守列入）
                    'ParamMouthAngry', 'ParamMouthAngryLine'
                }

                # 尝试读取模型的 .model3.json，提取 Groups -> Name == "LipSync" && Target == "Parameter" 的 Ids
                model_declared_mouth_params = set()
                try:
                    local_model_json = target_model_dir / model_json_file.name
                    if local_model_json.exists():
                        with open(local_model_json, 'r', encoding='utf-8') as mf:
                            try:
                                model_cfg = _json.load(mf)
                                groups = model_cfg.get('Groups') if isinstance(model_cfg, dict) else None
                                if isinstance(groups, list):
                                    for grp in groups:
                                        try:
                                            if not isinstance(grp, dict):
                                                continue
                                            # 仅考虑官方 Group Name 为 LipSync 且 Target 为 Parameter 的条目
                                            if grp.get('Name') == 'LipSync' and grp.get('Target') == 'Parameter':
                                                ids = grp.get('Ids') or []
                                                for pid in ids:
                                                    if isinstance(pid, str) and pid:
                                                        model_declared_mouth_params.add(pid)
                                        except Exception:
                                            continue
                            except Exception:
                                # 解析失败则视为未找到 groups，继续使用官方白名单
                                pass
                except Exception:
                    pass

                # 合并白名单（官方 + 模型声明）
                mouth_param_whitelist = set(official_mouth_params)
                mouth_param_whitelist.update(model_declared_mouth_params)

                for motion_path in target_model_dir.rglob('*.motion3.json'):
                    try:
                        with open(motion_path, 'r', encoding='utf-8') as mf:
                            try:
                                motion_data = _json.load(mf)
                            except Exception:
                                # 非 JSON 或解析失败则跳过
                                continue

                        modified = False
                        curves = motion_data.get('Curves') if isinstance(motion_data, dict) else None
                        if isinstance(curves, list):
                            for curve in curves:
                                try:
                                    if not isinstance(curve, dict):
                                        continue
                                    cid = curve.get('Id')
                                    if not cid:
                                        continue
                                    # 严格按白名单匹配（避免模糊匹配误伤）
                                    if cid in mouth_param_whitelist:
                                        # 清空 Segments（若存在）
                                        if 'Segments' in curve and curve['Segments']:
                                            curve['Segments'] = []
                                            modified = True
                                except Exception:
                                    continue

                        if modified:
                            try:
                                with open(motion_path, 'w', encoding='utf-8') as mf:
                                    _json.dump(motion_data, mf, ensure_ascii=False, indent=4)
                                logger.info(f"已清除口型参数：{motion_path}")
                            except Exception:
                                # 写入失败则记录但不阻止上传
                                logger.exception(f"写入 motion 文件失败: {motion_path}")
                    except Exception:
                        continue
            except Exception:
                logger.exception("处理 motion 文件时发生错误")
            
            logger.info(f"成功上传Live2D模型: {model_name} -> {target_model_dir}")
            
            return JSONResponse(content={
                "success": True,
                "message": f"模型 {model_name} 上传成功",
                "model_name": model_name,
                "model_path": str(target_model_dir)
            })
            
    except Exception as e:
        logger.error(f"上传Live2D模型失败: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post('/api/vrm/upload_model')
async def upload_vrm_model(files: list[UploadFile] = File(...)):
    """上传VRM模型到用户文档目录或static/models/vrm目录"""
    import shutil
    import tempfile
    
    try:
        if not files:
            return JSONResponse(status_code=400, content={"success": False, "error": "没有上传文件"})
        
        # 创建临时目录来处理上传的文件
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = pathlib.Path(temp_dir)
            
            # 保存所有上传的文件到临时目录，保持目录结构
            for file in files:
                # 从文件的相对路径中提取目录结构
                file_path = file.filename
                # 确保路径安全，移除可能的危险路径字符
                file_path = file_path.replace('\\', '/').lstrip('/')
                
                target_file_path = temp_path / file_path
                target_file_path.parent.mkdir(parents=True, exist_ok=True)
                
                # 保存文件
                with open(target_file_path, 'wb') as f:
                    content = await file.read()
                    f.write(content)
            
            # 在临时目录中递归查找.vrm文件
            vrm_files = list(temp_path.rglob('*.vrm'))
            
            if not vrm_files:
                return JSONResponse(status_code=400, content={"success": False, "error": "未找到.vrm文件"})
            
            if len(vrm_files) > 1:
                return JSONResponse(status_code=400, content={"success": False, "error": "上传的文件中包含多个.vrm文件，请一次只上传一个VRM模型"})
            
            vrm_file = vrm_files[0]
            
            # 确定模型名称（.vrm文件的文件名，去掉扩展名）
            model_name = vrm_file.stem
            
            # 获取目标目录（优先使用static/models/vrm，如果不存在则使用用户文档目录）
            static_vrm_dir = pathlib.Path('static/models/vrm')
            static_vrm_dir.mkdir(parents=True, exist_ok=True)
            
            # 目标目录：在static/models/vrm下创建以模型名命名的文件夹
            target_model_dir = static_vrm_dir / model_name
            
            # 如果目标目录已存在，返回错误
            if target_model_dir.exists():
                return JSONResponse(status_code=400, content={
                    "success": False, 
                    "error": f"VRM模型 {model_name} 已存在，请先删除或重命名现有模型"
                })
            
            # 创建目标目录
            target_model_dir.mkdir(parents=True, exist_ok=True)
            
            # 复制.vrm文件到目标目录
            target_vrm_file = target_model_dir / vrm_file.name
            shutil.copy2(vrm_file, target_vrm_file)
            
            # 如果上传的文件中有其他文件（如纹理、材质等），也一并复制
            for file_path in temp_path.rglob('*'):
                if file_path.is_file() and file_path != vrm_file:
                    relative_path = file_path.relative_to(temp_path)
                    target_file = target_model_dir / relative_path.name
                    if not target_file.exists():
                        shutil.copy2(file_path, target_file)
            
            logger.info(f"成功上传VRM模型: {model_name} -> {target_model_dir}")
            
            return JSONResponse(content={
                "success": True,
                "message": f"VRM模型 {model_name} 上传成功",
                "model_name": model_name,
                "model_path": f"/static/models/vrm/{model_name}/{vrm_file.name}"
            })
            
    except Exception as e:
        logger.error(f"上传VRM模型失败: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post('/api/live2d/emotion_mapping/{model_name}')
async def update_emotion_mapping(model_name: str, request: Request):
    """更新情绪映射配置"""
    try:
        data = await request.json()
        
        if not data:
            return JSONResponse(status_code=400, content={"success": False, "error": "无效的数据"})

        # 查找模型目录（可能在static或用户文档目录）
        model_dir, url_prefix = find_model_directory(model_name)
        if not os.path.exists(model_dir):
            return JSONResponse(status_code=404, content={"success": False, "error": "模型目录不存在"})
        
        # 查找.model3.json文件
        model_json_path = None
        for file in os.listdir(model_dir):
            if file.endswith('.model3.json'):
                model_json_path = os.path.join(model_dir, file)
                break
        
        if not model_json_path or not os.path.exists(model_json_path):
            return JSONResponse(status_code=404, content={"success": False, "error": "模型配置文件不存在"})

        with open(model_json_path, 'r', encoding='utf-8') as f:
            config_data = json.load(f)

        # 统一写入到标准 Cubism 结构（FileReferences.Motions / FileReferences.Expressions）
        file_refs = config_data.setdefault('FileReferences', {})

        # 处理 motions: data 结构为 { motions: { emotion: ["motions/xxx.motion3.json", ...] }, expressions: {...} }
        motions_input = (data.get('motions') if isinstance(data, dict) else None) or {}
        motions_output = {}
        for group_name, files in motions_input.items():
            # 禁止在"常驻"组配置任何motion
            if group_name == '常驻':
                logger.info("忽略常驻组中的motion配置（只允许expression）")
                continue
            items = []
            for file_path in files or []:
                if not isinstance(file_path, str):
                    continue
                normalized = file_path.replace('\\', '/').lstrip('./')
                items.append({"File": normalized})
            motions_output[group_name] = items
        file_refs['Motions'] = motions_output

        # 处理 expressions: 将按 emotion 前缀生成扁平列表，Name 采用 "{emotion}_{basename}" 的约定
        expressions_input = (data.get('expressions') if isinstance(data, dict) else None) or {}

        # 先保留不属于我们情感前缀的原始表达（避免覆盖用户自定义）
        existing_expressions = file_refs.get('Expressions', []) or []
        emotion_prefixes = set(expressions_input.keys())
        preserved_expressions = []
        for item in existing_expressions:
            try:
                name = (item.get('Name') or '') if isinstance(item, dict) else ''
                prefix = name.split('_', 1)[0] if '_' in name else None
                if not prefix or prefix not in emotion_prefixes:
                    preserved_expressions.append(item)
            except Exception:
                preserved_expressions.append(item)

        new_expressions = []
        for emotion, files in expressions_input.items():
            for file_path in files or []:
                if not isinstance(file_path, str):
                    continue
                normalized = file_path.replace('\\', '/').lstrip('./')
                base = os.path.basename(normalized)
                base_no_ext = base.replace('.exp3.json', '')
                name = f"{emotion}_{base_no_ext}"
                new_expressions.append({"Name": name, "File": normalized})

        file_refs['Expressions'] = preserved_expressions + new_expressions

        # 同时保留一份 EmotionMapping（供管理器读取与向后兼容）
        config_data['EmotionMapping'] = data

        # 保存配置到文件
        with open(model_json_path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"模型 {model_name} 的情绪映射配置已更新（已同步到 FileReferences）")
        return {"success": True, "message": "情绪映射配置已保存"}
    except Exception as e:
        logger.error(f"更新情绪映射配置失败: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post('/api/memory/recent_file/save')
async def save_recent_file(request: Request):
    import os, json
    data = await request.json()
    filename = data.get('filename')
    chat = data.get('chat')
    from utils.config_manager import get_config_manager
    cm = get_config_manager()
    file_path = str(cm.memory_dir / filename)
    if not (filename and filename.startswith('recent') and filename.endswith('.json')):
        return JSONResponse({"success": False, "error": "文件名不合法"}, status_code=400)
    arr = []
    for msg in chat:
        t = msg.get('role')
        text = msg.get('text', '')
        arr.append({
            "type": t,
            "data": {
                "content": text,
                "additional_kwargs": {},
                "response_metadata": {},
                "type": t,
                "name": None,
                "id": None,
                "example": False,
                **({"tool_calls": [], "invalid_tool_calls": [], "usage_metadata": None} if t == "ai" else {})
            }
        })
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(arr, f, ensure_ascii=False, indent=2)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post('/api/memory/update_catgirl_name')
async def update_catgirl_name(request: Request):
    """
    更新记忆文件中的猫娘名称
    1. 重命名记忆文件
    2. 更新文件内容中的猫娘名称引用
    """
    import os, json
    data = await request.json()
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    
    if not old_name or not new_name:
        return JSONResponse({"success": False, "error": "缺少必要参数"}, status_code=400)
    
    try:
        from utils.config_manager import get_config_manager
        cm = get_config_manager()
        
        # 1. 重命名记忆文件
        old_filename = f'recent_{old_name}.json'
        new_filename = f'recent_{new_name}.json'
        old_file_path = str(cm.memory_dir / old_filename)
        new_file_path = str(cm.memory_dir / new_filename)
        
        # 检查旧文件是否存在
        if not os.path.exists(old_file_path):
            logger.warning(f"记忆文件不存在: {old_file_path}")
            return JSONResponse({"success": False, "error": f"记忆文件不存在: {old_filename}"}, status_code=404)
        
        # 如果新文件已存在，先删除
        if os.path.exists(new_file_path):
            os.remove(new_file_path)
        
        # 重命名文件
        os.rename(old_file_path, new_file_path)
        
        # 2. 更新文件内容中的猫娘名称引用
        with open(new_file_path, 'r', encoding='utf-8') as f:
            file_content = json.load(f)
        
        # 遍历所有消息，仅在特定字段中更新猫娘名称
        for item in file_content:
            if isinstance(item, dict):
                # 安全的方式：只在特定的字段中替换猫娘名称
                # 避免在整个content中进行字符串替换
                
                # 检查角色名称相关字段
                name_fields = ['speaker', 'author', 'name', 'character', 'role']
                for field in name_fields:
                    if field in item and isinstance(item[field], str) and old_name in item[field]:
                        if item[field] == old_name:  # 完全匹配才替换
                            item[field] = new_name
                            logger.debug(f"更新角色名称字段 {field}: {old_name} -> {new_name}")
                
                # 如果item有data嵌套结构，也检查其中的name字段
                if 'data' in item and isinstance(item['data'], dict):
                    data = item['data']
                    for field in name_fields:
                        if field in data and isinstance(data[field], str) and old_name in data[field]:
                            if data[field] == old_name:  # 完全匹配才替换
                                data[field] = new_name
                                logger.debug(f"更新data中角色名称字段 {field}: {old_name} -> {new_name}")
                    
                    # 对于content字段，使用更保守的方法 - 仅在明确标识为角色名称的地方替换
                    if 'content' in data and isinstance(data['content'], str):
                        content = data['content']
                        # 检查是否是明确的角色发言格式，如"小白说："或"小白: "
                        # 这种格式通常表示后面的内容是角色发言
                        patterns = [
                            f"{old_name}说：",  # 中文冒号
                            f"{old_name}说:",   # 英文冒号  
                            f"{old_name}:",     # 纯冒号
                            f"{old_name}->",    # 箭头
                            f"[{old_name}]",    # 方括号
                        ]
                        
                        for pattern in patterns:
                            if pattern in content:
                                new_pattern = pattern.replace(old_name, new_name)
                                content = content.replace(pattern, new_pattern)
                                logger.debug(f"在消息内容中发现角色标识，更新: {pattern} -> {new_pattern}")
                        
                        data['content'] = content
        
        # 保存更新后的内容
        with open(new_file_path, 'w', encoding='utf-8') as f:
            json.dump(file_content, f, ensure_ascii=False, indent=2)
        
        logger.info(f"已更新猫娘名称从 '{old_name}' 到 '{new_name}' 的记忆文件")
        return {"success": True}
    except Exception as e:
        logger.exception("更新猫娘名称失败")
        return {"success": False, "error": str(e)}

@app.post('/api/emotion/analysis')
async def emotion_analysis(request: Request):
    try:
        data = await request.json()
        if not data or 'text' not in data:
            return {"error": "请求体中必须包含text字段"}
        
        text = data['text']
        api_key = data.get('api_key')
        model = data.get('model')
        
        # 使用参数或默认配置
        core_config = _config_manager.get_core_config()
        api_key = api_key or core_config['OPENROUTER_API_KEY']
        model = model or core_config['EMOTION_MODEL']
        
        if not api_key:
            return {"error": "API密钥未提供且配置中未设置默认密钥"}
        
        if not model:
            return {"error": "模型名称未提供且配置中未设置默认模型"}
        
        # 创建异步客户端
        client = AsyncOpenAI(api_key=api_key, base_url=core_config['OPENROUTER_URL'])
        
        # 构建请求消息
        messages = [
            {
                "role": "system", 
                "content": emotion_analysis_prompt
            },
            {
                "role": "user", 
                "content": text
            }
        ]
        
        # 异步调用模型
        request_params = {
            "model": model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 100
        }
        
        # 只有在需要时才添加 extra_body
        if model in MODELS_WITH_EXTRA_BODY:
            request_params["extra_body"] = {"enable_thinking": False}
        
        response = await client.chat.completions.create(**request_params)
        
        # 解析响应
        result_text = response.choices[0].message.content.strip()
        
        # 尝试解析JSON响应
        try:
            import json
            result = json.loads(result_text)
            # 获取emotion和confidence
            emotion = result.get("emotion", "neutral")
            confidence = result.get("confidence", 0.5)
            
            # 当confidence小于0.3时，自动将emotion设置为neutral
            if confidence < 0.3:
                emotion = "neutral"
            
            # 获取 lanlan_name 并推送到 monitor
            lanlan_name = data.get('lanlan_name')
            if lanlan_name and lanlan_name in sync_message_queue:
                sync_message_queue[lanlan_name].put({
                    "type": "json",
                    "data": {
                        "type": "emotion",
                        "emotion": emotion,
                        "confidence": confidence
                    }
                })
            
            return {
                "emotion": emotion,
                "confidence": confidence
            }
        except json.JSONDecodeError:
            # 如果JSON解析失败，返回简单的情感判断
            return {
                "emotion": "neutral",
                "confidence": 0.5
            }
            
    except Exception as e:
        logger.error(f"情感分析失败: {e}")
        return {
            "error": f"情感分析失败: {str(e)}",
            "emotion": "neutral",
            "confidence": 0.0
        }

@app.get('/memory_browser', response_class=HTMLResponse)
async def memory_browser(request: Request):
    return templates.TemplateResponse('templates/memory_browser.html', {"request": request})


@app.get("/{lanlan_name}", response_class=HTMLResponse)
async def get_index(request: Request, lanlan_name: str):
    # lanlan_name 将从 URL 中提取，前端会通过 API 获取配置
    return templates.TemplateResponse("templates/index.html", {
        "request": request
    })

@app.post('/api/agent/flags')
async def update_agent_flags(request: Request):
    """来自前端的Agent开关更新，级联到各自的session manager。"""
    try:
        data = await request.json()
        _, her_name_current, _, _, _, _, _, _, _, _ = _config_manager.get_character_data()
        lanlan = data.get('lanlan_name') or her_name_current
        flags = data.get('flags') or {}
        mgr = session_manager.get(lanlan)
        if not mgr:
            return JSONResponse({"success": False, "error": "lanlan not found"}, status_code=404)
        # Update core flags first
        mgr.update_agent_flags(flags)
        # Forward to tool server for MCP/Computer-Use flags
        try:
            forward_payload = {}
            if 'mcp_enabled' in flags:
                forward_payload['mcp_enabled'] = bool(flags['mcp_enabled'])
            if 'computer_use_enabled' in flags:
                forward_payload['computer_use_enabled'] = bool(flags['computer_use_enabled'])
            if forward_payload:
                async with httpx.AsyncClient(timeout=0.7) as client:
                    r = await client.post(f"http://localhost:{TOOL_SERVER_PORT}/agent/flags", json=forward_payload)
                    if not r.is_success:
                        raise Exception(f"tool_server responded {r.status_code}")
        except Exception as e:
            # On failure, reset flags in core to safe state
            mgr.update_agent_flags({'agent_enabled': False, 'computer_use_enabled': False, 'mcp_enabled': False})
            return JSONResponse({"success": False, "error": f"tool_server forward failed: {e}"}, status_code=502)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get('/api/agent/flags')
async def get_agent_flags():
    """获取当前 agent flags 状态（供前端同步）"""
    try:
        async with httpx.AsyncClient(timeout=0.7) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/agent/flags")
            if not r.is_success:
                return JSONResponse({"success": False, "error": "tool_server down"}, status_code=502)
            return r.json()
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=502)


@app.get('/api/agent/health')
async def agent_health():
    """Check tool_server health via main_server proxy."""
    try:
        async with httpx.AsyncClient(timeout=0.7) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/health")
            if not r.is_success:
                return JSONResponse({"status": "down"}, status_code=502)
            data = {}
            try:
                data = r.json()
            except Exception:
                pass
            return {"status": "ok", **({"tool": data} if isinstance(data, dict) else {})}
    except Exception:
        return JSONResponse({"status": "down"}, status_code=502)


@app.get('/api/agent/computer_use/availability')
async def proxy_cu_availability():
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/computer_use/availability")
            if not r.is_success:
                return JSONResponse({"ready": False, "reasons": [f"tool_server responded {r.status_code}"]}, status_code=502)
            return r.json()
    except Exception as e:
        return JSONResponse({"ready": False, "reasons": [f"proxy error: {e}"]}, status_code=502)


@app.get('/api/agent/mcp/availability')
async def proxy_mcp_availability():
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/mcp/availability")
            if not r.is_success:
                return JSONResponse({"ready": False, "reasons": [f"tool_server responded {r.status_code}"]}, status_code=502)
            return r.json()
    except Exception as e:
        return JSONResponse({"ready": False, "reasons": [f"proxy error: {e}"]}, status_code=502)


@app.get('/api/agent/tasks')
async def proxy_tasks():
    """Get all tasks from tool server via main_server proxy."""
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/tasks")
            if not r.is_success:
                return JSONResponse({"tasks": [], "error": f"tool_server responded {r.status_code}"}, status_code=502)
            return r.json()
    except Exception as e:
        return JSONResponse({"tasks": [], "error": f"proxy error: {e}"}, status_code=502)


@app.get('/api/agent/tasks/{task_id}')
async def proxy_task_detail(task_id: str):
    """Get specific task details from tool server via main_server proxy."""
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/tasks/{task_id}")
            if not r.is_success:
                return JSONResponse({"error": f"tool_server responded {r.status_code}"}, status_code=502)
            return r.json()
    except Exception as e:
        return JSONResponse({"error": f"proxy error: {e}"}, status_code=502)


# Task status polling endpoint for frontend
@app.get('/api/agent/task_status')
async def get_task_status():
    """Get current task status for frontend polling - returns all tasks with their current status."""
    try:
        # Get tasks from tool server using async client with increased timeout
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(f"http://localhost:{TOOL_SERVER_PORT}/tasks")
            if not r.is_success:
                return JSONResponse({"tasks": [], "error": f"tool_server responded {r.status_code}"}, status_code=502)
            
            tasks_data = r.json()
            tasks = tasks_data.get("tasks", [])
            debug_info = tasks_data.get("debug", {})
            
            # Enhance task data with additional information if needed
            enhanced_tasks = []
            for task in tasks:
                enhanced_task = {
                    "id": task.get("id"),
                    "status": task.get("status", "unknown"),
                    "type": task.get("type", "unknown"),
                    "lanlan_name": task.get("lanlan_name"),
                    "start_time": task.get("start_time"),
                    "end_time": task.get("end_time"),
                    "params": task.get("params", {}),
                    "result": task.get("result"),
                    "error": task.get("error"),
                    "source": task.get("source", "unknown")  # 添加来源信息
                }
                enhanced_tasks.append(enhanced_task)
            
            return {
                "success": True,
                "tasks": enhanced_tasks,
                "total_count": len(enhanced_tasks),
                "running_count": len([t for t in enhanced_tasks if t.get("status") == "running"]),
                "queued_count": len([t for t in enhanced_tasks if t.get("status") == "queued"]),
                "completed_count": len([t for t in enhanced_tasks if t.get("status") == "completed"]),
                "failed_count": len([t for t in enhanced_tasks if t.get("status") == "failed"]),
                "timestamp": datetime.now().isoformat(),
                "debug": debug_info  # 传递调试信息到前端
            }
        
    except Exception as e:
        return JSONResponse({
            "success": False,
            "tasks": [],
            "error": f"Failed to fetch task status: {str(e)}",
            "timestamp": datetime.now().isoformat()
        }, status_code=500)


@app.post('/api/agent/admin/control')
async def proxy_admin_control(payload: dict = Body(...)):
    """Proxy admin control commands to tool server."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(f"http://localhost:{TOOL_SERVER_PORT}/admin/control", json=payload)
            if not r.is_success:
                return JSONResponse({"success": False, "error": f"tool_server responded {r.status_code}"}, status_code=502)
            
            result = r.json()
            logger.info(f"Admin control result: {result}")
            return result
        
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": f"Failed to execute admin control: {str(e)}"
        }, status_code=500)

# --- Run the Server ---
if __name__ == "__main__":
    import uvicorn
    import argparse
    import signal
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--open-browser",   action="store_true",
                        help="启动后是否打开浏览器并监控它")
    parser.add_argument("--page",           type=str, default="",
                        choices=["index", "chara_manager", "api_key", ""],
                        help="要打开的页面路由（不含域名和端口）")
    args = parser.parse_args()

    logger.info("--- Starting FastAPI Server ---")
    # Use os.path.abspath to show full path clearly
    logger.info(f"Serving static files from: {os.path.abspath('static')}")
    logger.info(f"Serving index.html from: {os.path.abspath('templates/index.html')}")
    logger.info(f"Access UI at: http://127.0.0.1:{MAIN_SERVER_PORT} (or your network IP:{MAIN_SERVER_PORT})")
    logger.info("-----------------------------")

    # 使用统一的速率限制日志过滤器
    from utils.logger_config import create_main_server_filter, create_httpx_filter
    
    # Add filter to uvicorn access logger
    logging.getLogger("uvicorn.access").addFilter(create_main_server_filter())
    
    # Add filter to httpx logger for availability check requests
    logging.getLogger("httpx").addFilter(create_httpx_filter())

    # 1) 配置 UVicorn
    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=MAIN_SERVER_PORT,
        log_level="info",
        loop="asyncio",
        reload=False,
    )
    server = uvicorn.Server(config)
    
    # Set browser mode flag if --open-browser is used
    if args.open_browser:
        # 使用 FastAPI 的 app.state 来管理配置
        start_config = {
            "browser_mode_enabled": True,
            "browser_page": args.page if args.page!='index' else '',
            'server': server
        }
        set_start_config(start_config)
    else:
        # 设置默认配置
        start_config = {
            "browser_mode_enabled": False,
            "browser_page": "",
            'server': server
        }
        set_start_config(start_config)

    print(f"启动配置: {get_start_config()}")

    # 2) 定义服务器关闭回调
    def shutdown_server():
        logger.info("收到浏览器关闭信号，正在关闭服务器...")
        os.kill(os.getpid(), signal.SIGTERM)

    # 4) 启动服务器（阻塞，直到 server.should_exit=True）
    logger.info("--- Starting FastAPI Server ---")
    logger.info(f"Access UI at: http://127.0.0.1:{MAIN_SERVER_PORT}/{args.page}")
    
    try:
        server.run()
    finally:
        logger.info("服务器已关闭")