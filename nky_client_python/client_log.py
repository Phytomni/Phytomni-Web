# log.py
import os
import datetime
import logging

def setup_daily_logger(log_dir='tool_log', log_prefix='tool'):
    """
    高效设置每日日志记录器
    
    只在初始化时检查日期，后续调用无额外开销
    """
    # 确保日志目录存在
    os.makedirs(log_dir, exist_ok=True)
    
    # 获取当前日期并创建日志文件路径
    current_date = datetime.datetime.now().strftime('%Y-%m-%d')
    log_filename = f'{log_prefix}_{current_date}.log'
    log_path = os.path.join(log_dir, log_filename)
    
    # 创建Logger
    logger = logging.getLogger(f'{log_prefix}_logger')
    logger.setLevel(logging.INFO)
    
    # 移除旧的FileHandler（避免重复添加）
    for handler in logger.handlers[:]:
        if isinstance(handler, logging.FileHandler):
            logger.removeHandler(handler)
    
    # 创建FileHandler
    fh = logging.FileHandler(log_path, encoding='utf-8', mode='a')
    fh.setLevel(logging.INFO)
    
    # 设置日志格式
    formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    fh.setFormatter(formatter)
    
    logger.addHandler(fh)
    
    # 记录初始化信息
    logger.info(f"=== 日志系统初始化完成: {log_path} ===")
    
    return logger

# 初始化日志记录器（只需一次）
tool_logger = setup_daily_logger()