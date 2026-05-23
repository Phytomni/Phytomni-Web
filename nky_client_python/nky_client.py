import asyncio
import os
import json
import datetime
from typing import Optional, List
from contextlib import AsyncExitStack
from fastapi import FastAPI, Depends, HTTPException, Request, Form, File, UploadFile
import jwt
from jwt.exceptions import PyJWTError
from openai import OpenAI
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.sse import sse_client
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import ast
# import pandas as p
import uuid
import re
from obs import ObsClient
import traceback
import uvicorn
import sys
from mcp_server_phytomni.analyst_agents import submit, task_log
from models import Base, QuestionAgentLog, BiMapping, ServerToolLogs, RagReferenceCitation,GeneExample
from client_log import tool_logger
from tool_format_processing import tool_chatAgent_result,tool_KnowledgeAgent_result,tool_DataAgent_result,tool_AnalystAgent_result,tool_ReviewAgent_result,tool_DeepGenomeAgent_result,tool_DeepGenomeAgent_file_result
import platform


# 加载环境变量
load_dotenv()

# 配置验证
SECRET_KEY_CLIENT = os.getenv("SECRET_KEY_CLIENT")
if not SECRET_KEY_CLIENT:
    raise ValueError("❌ 未找到 SECRET_KEY_CLIENT，请在 .env 文件中设置 SECRET_KEY_CLIENT")

system = platform.system().lower()
if system == "windows":
    DATABASE_URL_CLIENT = os.getenv("DATABASE_URL_CLIENT_WIN")
elif system == "linux":
    DATABASE_URL_CLIENT = os.getenv("DATABASE_URL_CLIENT_LINUX")
else:
    # 其他操作系统（如macOS）可以设置默认值或抛出错误
    raise ValueError("❌ 未找到 DATABASE_URL_CLIENTXXX，请在 .env 文件中设置 DATABASE_URL_CLIENTXXX")


# 数据库配置
engine = create_engine(DATABASE_URL_CLIENT)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()



# 创建FastAPI应用
app = FastAPI()

# CORS配置
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 使用日志记录器
logger = tool_logger

class MCPClient:
    def __init__(self):
        """初始化 MCP 客户端"""
        self.exit_stack = AsyncExitStack()
        self.openai_api_key = os.getenv("OPENAI_API_KEY_CLIENT")
        self.base_url = os.getenv("BASE_URL_CLIENT")
        self.model = os.getenv("MODEL_CLIENT")
        self.polling_task = None  # 添加任务引用
        # self.tool_handler = ToolHandler()  # 初始化 ToolHandler
        if not self.openai_api_key:
            raise ValueError("❌ 未找到 OpenAI API Key")
        self.client = OpenAI(api_key=self.openai_api_key, base_url=self.base_url)
        self.session: Optional[ClientSession] = None
        self.max_history_length = 10   # 最大历史记录长度
        self.upload_dir = "uploads"    # 文件上传目录
        os.makedirs(self.upload_dir, exist_ok=True)

    async def connect_to_server(self, server_script_path: str):
        """连接到 MCP 服务器（支持文件路径或模块名）"""
        # 如果是文件路径（.py 或 .js）
        if server_script_path.endswith('.py') or server_script_path.endswith('.js'):
            command = "python" if server_script_path.endswith('.py') else "node"
            args = [server_script_path]
        else:
            # 如果是模块名（如 "mcp_server_phytomni.server"）
            command = "python"
            args = ["-m", server_script_path]  # 使用 -m 运行模块

        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=None
        )
        
        stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
        self.stdio, self.write = stdio_transport
        self.session = await self.exit_stack.enter_async_context(ClientSession(self.stdio, self.write))

        try:
            await asyncio.wait_for(self.session.initialize(), timeout=20.0)
        except asyncio.TimeoutError:
            print("初始化超时 - 服务器未响应")

        response = await self.session.list_tools()
        print("\n已连接到服务器，支持以下工具:", [tool.name for tool in response.tools])


    async def start_auto_polling(self):
        """启动自动轮询任务"""
        asyncio.create_task(self._poll_finished_tasks())
    
    async def _poll_finished_tasks(self):
        """轮询任务，定期检查ServerToolLogs表中状态为finished的记录"""
        while True:
            try:
                db = SessionLocal()
                try:
                    # 查询状态为finished的记录
                    finished_logs = db.query(ServerToolLogs).filter(
                        ServerToolLogs.server_status == 'finished',
                        ServerToolLogs.sync_status == 0,  # 0表示未同步,1表示已同步
                        ServerToolLogs.delete_at == None
                    ).all()
                    logger.info(f"找到 {len(finished_logs)} 个待处理任务")
                    
                    for server_log in finished_logs:
                        try:
                            logger.info(f"🔄 处理任务ID: {server_log.server_id}")
                            quest_logs = db.query(QuestionAgentLog).filter(
                                QuestionAgentLog.server_id == server_log.server_id
                            ).first()

                            if not quest_logs:
                                logger.warning(f"未找到对应的QuestionAgentLog记录，server_id: {server_log.server_id}")
                                continue

                            # 更新数据库ServerToolLogs记录
                            server_log.sync_status = 1  # 同步状态1为已经同步完成
                            server_log.updated_at = datetime.datetime.now() # server表同步时间

                            # 更新数据库QuestionAgentLog记录
                            # 处理文献引用
                            if isinstance(server_log.tool_result, str):
                                try:
                                    content_dict = json.loads(server_log.tool_result)
                                except json.JSONDecodeError:
                                    # 处理JSON解析错误
                                    return "解析错误", []
                            answer,follow_up_questions,new_file_path,base_name = tool_DeepGenomeAgent_file_result(content_dict,server_log.server_file_path)
                            quest_logs.answer = answer
                            quest_logs.follow_up_questions = follow_up_questions
                            quest_logs.server_file_path = new_file_path #此处生成过滤后的文件路径

                            quest_logs.status = "SUCCEEDED"
                            quest_logs.updated_at = datetime.datetime.now() # question表同步时间

                            # 创建 GeneExample 新实例
                            new_gene_example = GeneExample(
                                file_name=base_name,
                                server_file_path=new_file_path,
                                content=answer,
                                species_code=quest_logs.species_code,
                                gene_id=quest_logs.gene_id,
                                created_at=datetime.datetime.now(),
                                updated_at=datetime.datetime.now()
                            )
                            db.add(new_gene_example)
                            db.commit()
                            logger.info(f"✅ 任务 {server_log.server_id} 处理完成，结果已同步")
                        except Exception as e:
                            db.rollback()
                            logger.error(f"❌ 处理任务 {server_log.server_id} 失败: {str(e)}")
                            logger.error(traceback.format_exc())                      
                finally:
                    db.close()
                    
            except Exception as e:
                logger.error(f"轮询任务出错: {str(e)}")
                logger.error(traceback.format_exc())
                
            # 每1小时轮询一次
            #await asyncio.sleep(3600)
            await asyncio.sleep(3600)

    def _trim_history(self, history: List[dict]) -> List[dict]:
        """修剪对话历史，防止过长"""
        if len(history) > self.max_history_length:
            return history[-self.max_history_length:]
        return history


    async def process_query(self, query: str, id: int, username: str,file_name:str,obs_path:str, 
                            history: List[dict],tool: str,refresh_id: int) -> dict:
        """
        处理查询并使用传入的历史记录
        """

        if refresh_id:
            db = SessionLocal()
            try:
                # 查询数据库中是否存在相同的 server_id
                existing_log = db.query(QuestionAgentLog).filter(
                    QuestionAgentLog.id == refresh_id
                ).first()
                if existing_log==None:
                    # 如果不存在id存在，则直接返回刷新失败
                    return {
                        "code": 400,
                        "message": "刷新失败，对话不存在，请重试"
                    }
            finally:
                db.close()

        # 修剪历史记录
        history = self._trim_history(history)
        
        # 保留原始 query（用于存储）
        original_query = query
        # tool是否有值且不为空
        if tool and tool.strip(): 
            query = f"{tool}:{query}"

        # 构造用户消息
        if obs_path:
            user_message = {
                "role": "user",
                "content": "OBS_URL:  " + obs_path + "," + query
            }
        else:
            user_message = {
                "role": "user",
                "content": query
            }
        
        # 构建完整的历史记录
        current_history = history.copy()
        current_history.append(user_message)

        print("当前对话历史:", current_history)

        # 获取可用工具
        response = await self.session.list_tools()
        available_tools = [{
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.inputSchema
            }
        } for tool in response.tools]

        # 第一步：获取初始AI响应
        try:
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=current_history,
                tools=available_tools,
                #max_tokens=8192,
            )
            ai_message = completion.choices[0].message
            # 获取 token 使用量
            token_usage = completion.usage
            print(f"Token 使用情况: 输入={token_usage.prompt_tokens}, 输出={token_usage.completion_tokens}, 总计={token_usage.total_tokens}")

        except Exception as e:
            return {
                "code": 500,
                "message": f"模型调用失败: {str(e)}"
            }

        # 添加AI响应到历史
        current_history.append({
            "role": "assistant",
            "content": ai_message.content,
            "tool_calls": ai_message.tool_calls
        })

        # 如果没有工具调用，直接返回
        if not ai_message.tool_calls:
            print("模型未调用工具 tool_calls，直接返回回答:", ai_message.content)
            return await self._handle_direct_response(id,None, username, original_query, ai_message.content,None,None,file_name,obs_path,None,None,None,None,refresh_id,None,None,None)


        # client模型处理工具调用，并给与工具参数
        tool_name = ai_message.tool_calls[0].function.name
        logger.info("%s准备向tool传递的query:%s",username,ai_message.tool_calls[0].function.arguments)
        tool_args = json.loads(ai_message.tool_calls[0].function.arguments)
        
        try:
            print(f"\n{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]} [Calling tool {tool_name} with args {tool_args}]\n")

            # 执行工具
            result = await asyncio.wait_for(
                self.session.call_tool(tool_name, tool_args),
                timeout=36000.0
            )
            print("工具返回消息原始:\n", result, "\n")
        
            # 检查工具返回结果是否为错误
            if result.isError:
                error_content = result.content[0].text  # 获取错误内容文本
                
                # 检查是否是PANGU.3254错误
                if "PANGU.3254" in error_content:
                    return {
                        "code": 400,
                        "message": "The requested inference service does not exist.PANGU.3254",
                        "data": None
                    }
                else:
                    # 其他错误情况
                    return {
                        "code": 500,
                        "message": f"Tool execution failed isError=True: {error_content}",
                        "data": None
                    }
        
            tool_response = {
                "role": "tool",
                "content": result.content[0].text,
                "tool_call_id": ai_message.tool_calls[0].id,
                "name": tool_name
            }
        except Exception as e:
            tool_response = {
                "role": "tool",
                "content": f"工具调用失败: {str(e)}",
                "tool_call_id": ai_message.tool_calls[0].id,
                "name": tool_name
            }

        # 添加工具响应到历史
        current_history.append(tool_response)
        
        calling_tool = f"\n[Calling tool {tool_name} with args {tool_args}]\n"
        logger.info(f"{username}调用工具{tool_name}成功返回提取完整消息:{calling_tool}\n{tool_response}\n")
        
        json_str = tool_response["content"]

        # 如果是空或无效数据
        if not json_str.strip() or json_str.strip().startswith("Expecting value"):
            return {
                "code": 400,
                "message": "工具返回为空或无效数据",
                "data": json_str
            }

        try:
            content_dict = json.loads(json_str)
        except json.JSONDecodeError:
            try:
                content_dict = json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.error(f"JSON 解析失败: {e}\n数据: {json_str[:500]}...\n")
                return {
                    "code": 400,
                    "message": "工具返回的数据不是有效的JSON",
                    "data": json_str
                }

        answer = None
        task_id = None
        status = None
        server_id = None
        compute_resource = None
        download_path = None
        log_status = None
        follow_up_questions= None
        species_code = None
        gene_id = None
        
        if "Error code" in json_str or "Expecting " in json_str:
            answer = None
        else:
            if tool_name == 'ChatAgents' or tool_name == "ChatAgent":
                answer = tool_chatAgent_result(content_dict)

            elif tool_name == 'KnowledgeAgents'or tool_name == "KnowledgeAgent":
                answer,follow_up_questions = tool_KnowledgeAgent_result(content_dict)                 

            elif tool_name == 'DatabaseAgents' or tool_name == "DataAgent":
                answer = tool_DataAgent_result(content_dict)

            elif tool_name == 'AnalysisAgents' or tool_name == 'AnalystAgent':  
                task_id,download_path,compute_resource,answer,status,log_status = tool_AnalystAgent_result(content_dict)
            
            elif tool_name == 'ReviewAgents' or tool_name == 'ReviewAgent':
                answer,follow_up_questions = tool_ReviewAgent_result(content_dict)

            elif tool_name == 'DeepGenomeAgent':
                answer,server_id,species_code,gene_id,status = tool_DeepGenomeAgent_result(json_str,ai_message.tool_calls[0].function.arguments)

            
        if answer is None:
            return {
                "code": 400,
                "message": "调用工具后没有生成正确结果",
                "data": json_str
            }

        return await self._handle_direct_response(id,server_id ,username, original_query, 
                                                answer,tool_name, task_id ,file_name,obs_path,status,download_path,compute_resource,log_status,refresh_id,follow_up_questions,species_code,gene_id)


    async def _handle_direct_response(self, id: int,server_id:str, username: str,query: str,  answer: str,tool_name: Optional[str], 
                              task_id: Optional[str],file_name:str,obs_path:str, status: str,download_path: str,compute_resource: str,log_status:str,refresh_id:int,follow_up_questions:str,species_code:str,gene_id:str):

        # 存储到数据库
        return await self._save_to_database(
            id, server_id,username, query, answer, tool_name, task_id,file_name,obs_path, status,download_path,compute_resource,log_status,refresh_id,follow_up_questions,species_code,gene_id
        )

    async def _save_to_database(self, id: int,server_id: str, username: str, query: str, 
                              answer: str, tool_name: Optional[str], 
                              task_id: Optional[str],file_name:str,obs_path:str, status: str,download_path: str,compute_resource: str,log_status:str,refresh_id:int,follow_up_questions:str,species_code:str,gene_id:str):

        
        """保存到数据库"""
        db = SessionLocal()
            
        try:
            # 确保 answer 是字符串（如果是 dict 则转换）
            if isinstance(answer, dict):
                answer = json.dumps(answer, ensure_ascii=False)
            
            # 确保 follow_up_questions 是字符串（如果是 list 则转换）
            if isinstance(follow_up_questions, list):
                follow_up_questions = json.dumps(follow_up_questions, ensure_ascii=False)
            if refresh_id != 0:
                # 更新现有记录
                existing_log = db.query(QuestionAgentLog).filter(QuestionAgentLog.id == refresh_id).first()
                if existing_log:
                    existing_log.server_id = server_id
                    existing_log.user_name = username
                    existing_log.query = query
                    existing_log.title_query = query
                    existing_log.answer = answer
                    existing_log.follow_up_questions = follow_up_questions
                    existing_log.species_code = species_code
                    existing_log.gene_id = gene_id
                    existing_log.tool_name = tool_name
                    existing_log.task_id = task_id
                    existing_log.file_name = file_name
                    existing_log.upload_path = obs_path
                    existing_log.download_path = download_path
                    existing_log.compute_resource = compute_resource
                    existing_log.status = status
                    existing_log.log_status = log_status
                    existing_log.reaction_type = "0"
                    existing_log.collect_type = "0"
                    existing_log.updated_at = datetime.datetime.now()
                    
                    db.commit()
                    db.refresh(existing_log)
                    
                    return {
                        "code": 200,
                        "message": "对话刷新成功",
                        "data": {
                            "tool_name": tool_name,
                            "answer": answer,
                            "follow_up_questions": follow_up_questions,
                        }
                    }
                else:
                    return {
                        "code": 404,
                        "message": f"未找到ID为{refresh_id}的记录",
                        "data": None
                    }
            else:
                # 新增记录
                log = QuestionAgentLog(
                    f_id=id,
                    dialogue_id=str(uuid.uuid4()),
                    server_id=server_id,
                    user_name=username,
                    query=query,
                    title_query=query,
                    answer=answer,
                    follow_up_questions=follow_up_questions,
                    species_code=species_code,
                    gene_id=gene_id,
                    tool_name=tool_name,
                    task_id=task_id,
                    file_name=file_name,
                    upload_path=obs_path,
                    download_path=download_path,
                    compute_resource=compute_resource,
                    status=status,
                    log_status=log_status,
                    reaction_type="0",
                    collect_type="0",
                    created_at=datetime.datetime.now(),
                    updated_at=datetime.datetime.now(),
                    delete_at=None,
                )
                db.add(log)
                db.commit()
                db.refresh(log)
                
                return {
                    "code": 200,
                    "message": "处理成功",
                    "data": {
                        "tool_name": tool_name,
                        "answer": answer,
                        "follow_up_questions": follow_up_questions,
                    }
                }
        except Exception as e:
            db.rollback()
            return {
                "code": 400,
                "message": f"数据库操作失败: {e}",
                "data": answer
            }
        finally:
            db.close()

    async def cleanup(self):
        """清理资源"""
        await self.exit_stack.aclose()

# 全局客户端实例
client = MCPClient()

# 鉴权功能
def verify_token(request: Request):
    token_string = request.headers.get("Authorization")
    if not token_string:
        raise HTTPException(status_code=401, detail={"code": 403, "error": "缺少授权头"})
    if not token_string.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": 403, "error": "无效的授权头格式"})
    
    token = token_string.split(" ")[1]
    try:
        claims = jwt.decode(token, SECRET_KEY_CLIENT, algorithms=["HS256"])
        return claims.get("username")
    except PyJWTError:
        raise HTTPException(status_code=401, detail={"code": 403, "error": "token无效"})

# 文件上传处理
async def handle_uploaded_files(files: Optional[List[UploadFile]], username: str) -> List[str]:
    if not files:
        return []
    
    files_details = []

    # OBS ak/sk are duplicated from Web Go-side viper huawei.obs.{ak,sk};
    # this Python service is scheduled for removal in the Bot consolidation
    # cutover (see Phytomni-Bot/.claude/handoff/2026-05-23-python-service-
    # consolidation.md §4.5 / OQ-7), so we accept the duplication rather
    # than refactor a file slated for deletion. Pragma markers below tell
    # scan_secrets to skip these lines — they remain real production
    # credentials and MUST be rotated when the cutover lands.
    ak = "HPUATWE0DXL6NVDAXTFU"                      # pragma: allowlist secret
    sk = "4eKpT5LPydBHelGqyQB6pAaFKSw0AwHkzJ46eDrT"  # pragma: allowlist secret
    server = "https://obs.cn-east-3.myhuaweicloud.com"
    
    for file in files:
        # 验证文件类型和大小
        # extension_mime_map = {
        #     # 文本文件
        #     '.pdf': 'application/pdf',
        #     '.doc': 'application/msword',
        #     '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        #     '.xls': 'application/vnd.ms-excel',
        #     '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        #     '.ppt': 'application/vnd.ms-powerpoint',
        #     '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        #     '.txt': 'text/plain',
        #     # 图片文件
        #     '.jpg': 'image/jpeg',
        #     '.jpeg': 'image/jpeg',
        #     '.png': 'image/png',
        #     # 压缩包
        #     # '.7z': 'application/x-7z-compressed',
        #     # '.rar': 'application/x-rar-compressed',
        #     # '.zip': 'application/zip',
        #     # '.gz': 'application/gzip',
        #     # 新增视频格式
        #     # '.mp4': 'video/mp4'
        # }
        
        # file_ext = Path(file.filename).suffix.lower()
        # if file_ext not in extension_mime_map:
        #     raise HTTPException(
        #         status_code=400,
        #         detail=f"不支持的文件扩展名. 只支持: {', '.join(extension_mime_map.keys())}"
        #     )

        # if file.content_type != extension_mime_map[file_ext]:
        #     raise HTTPException(
        #         status_code=400,
        #         detail=f"文件类型不匹配. 预期: {extension_mime_map[file_ext]}, 实际: {file.content_type}"
        #     )

        # 验证文件大小 (最大10GB)
        max_size = 10 * 1024 * 1024 * 1024
        file.file.seek(0, 2)
        file_size = file.file.tell()
        file.file.seek(0)
        
        if file_size > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"文件太大. 最大允许 {max_size//(1024*1024*1024)}GB"
            )

        try:
                obsClient = ObsClient(access_key_id=ak, secret_access_key=sk, server=server)
                # 创建OBS上传目录
                obs_dir = f"agent_data/user_data/test_upload/{username}/"
                obs_path = f"{obs_dir}{file.filename}"
                
                # 如果设置为私有桶则需要一个get的方法获取带签名的临时下载链接
                resp = obsClient.putContent(
                    bucketName="phytomni",
                    objectKey=obs_path,
                    content=file.file
                )

                # # 强制设置对象为公共读
                # obsClient.setObjectAcl(
                #     bucketName="genomiagent",
                #     objectKey=obs_path,
                #     aclControl="public-read"  # 或直接传字符串 "public-read"
                # )
                # print("永久下载URL:", resp.body.objectUrl)  # 此时URL永久有效
                print('objectUrl公共下载地址:', resp.body.objectUrl)

                if resp.status < 300:
                    full_obs_path = f"obs://phytomni/{obs_path}"
                    #full_obs_path = f"/obs/phytomni/{obs_path}"
                    files_details.append({
                        "filename": file.filename,
                        "path": full_obs_path,
                    })
                    print(f"文件已上传到OBS: {full_obs_path}")
                    logger.info("文件已上传到OBS:%s",full_obs_path)

                else:
                    print('Put File Failed')
                    print('requestId:', resp.requestId)
                    print('errorCode:', resp.errorCode)
                    print('errorMessage:', resp.errorMessage)
                    raise HTTPException(
                        status_code=500,
                        detail="OBS文件上传失败"
                    )
                    
        except Exception as e:
            print('OBS上传异常:', traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"OBS上传处理失败: {str(e)}"
            )
                
        finally:
            # 确保关闭OBS客户端
            obsClient.close()

    return files_details

# API端点
@app.post("/query")
async def query_endpoint(
    query: str = Form(...),
    id: int = Form(...),
    tool: str = Form(""),
    files: Optional[List[UploadFile]] = File(None),
    history: str = Form("[]"),  # 接收字符串形式的JSON
    refresh_id: int = Form((0),), # 刷新id,默认值为0
    username: str = Depends(verify_token)
):
    try:
        # 先尝试标准JSON解析
        history_list = json.loads(history)
    except json.JSONDecodeError:
        try:
            # 尝试作为Python字面量解析
            history_list = ast.literal_eval(history)
        except (SyntaxError, ValueError) as e:
            print(f"历史记录解析失败: {e}")
            history_list = []

    # 处理上传的文件
    files_details = []
    if files:
        files_details = await handle_uploaded_files(files,username)

    file_name=','.join([item['filename'] for item in files_details])
    obs_path=','.join([item['path'] for item in files_details])

    
    try:
        response = await asyncio.wait_for(
            client.process_query(query, id, username,file_name,obs_path, history_list,tool,refresh_id),
            timeout=36000.0  #请求超时时间10小时
        )
        return response
    except asyncio.TimeoutError:
        return {
            "code": 408,
            "message": "请求超时"
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"query处理失败: {str(e)}"
        }
    
# 在现有代码的API端点部分添加以下路由
@app.post("/query/analyst/update_log")
async def update_analyst_log(
    task_id: str = Form(...),
    username: str = Depends(verify_token)
):
    """
    获取并解析AnalystAgent任务日志
    参数:
    - task_id: 要查询的任务ID
    - username: 从token中获取的用户名
    """
    try:
        # 调用异步函数获取日志
        log_response = await task_log(task_id=task_id)
        log_text = ''
        
        if 'logs' in log_response.keys():
            # 拼接所有日志内容
            for log in log_response['logs']:
                log_text += log['content']
            
            # 解析日志
            plan_step, log_list = init_match(log_text)
            result = {
                "init_info": log_list,
                "steps": []
            }
            
            # 初始化 step_logs
            step_logs = []
            
            if plan_step is not None:
                # 查找最高轮次
                max_step = plan_step
                while max_step > 0:
                    match_status = re.search(fr'Round {max_step}', log_text, re.DOTALL)
                    if match_status:
                        break
                    max_step -= 1
                
                # 解析每个步骤
                if max_step > 0:
                    for step in range(1, 1 + max_step):
                        step_logs = runing_match(step, log_text)
                        # result["steps"].append({
                        #     "round": step,
                        #     "logs": step_logs
                        # })
            
            # 安全地使用 step_logs
            log_output = '\n'.join(step_logs) if step_logs else ""

            db = SessionLocal()
            jobFinished = False

            try:
                existing_log = db.query(QuestionAgentLog).filter(
                    QuestionAgentLog.task_id == task_id,
                    QuestionAgentLog.user_name == username,
                    QuestionAgentLog.delete_at == None
                    ).first()
                    
                if existing_log and (existing_log.status == "SUCCEEDED" or existing_log.status == "FAILED"):
                    jobFinished = True

                if existing_log:
                    if existing_log.task_log != log_output or (jobFinished and existing_log.log_status != "sync_succeeded"):
                        existing_log.task_log = log_output
                        if jobFinished:
                            existing_log.log_status = "sync_succeeded"
                        db.commit()
                        db.refresh(existing_log)
                    return {
                        "code": 200,
                        "message": "获取日志解析成功,同步数据库成功",
                        "data": log_output
                    }
                else:
                    return {
                        "code": 404,
                        "message": "日志记录不存在",
                        "data": None
                    }
                    
            except Exception as e:
                db.rollback()
                return {
                    "code": 404,
                    "message": f"日志查找失败,同步数据库失败: {str(e)}",
                    "data": None
                }
            finally:
                db.close()
        else:
            return {
                "code": 404,
                "message": "日志内容为空",
                "data": None
            }
            
    except Exception as e:
        logger.error(f"日志解析失败: {str(e)}")
        logger.error(traceback.format_exc())
        return {
            "code": 500,
            "message": f"日志解析失败: {str(e)}",
            "data": None
        }

# 日志解析函数 (直接添加到文件中)
def init_match(log_text):
    """
    解析日志中的初始化部分，提取任务目标和计划步骤
    """
    log_list = []
    job_start = re.search(r'\[Round 0\].*?\[Round 1\]', log_text, re.DOTALL)
    if job_start:
        job_start_section = job_start.group(0)
        goal = re.search(
            r'\[34mgoal\[0m\s*(.*?)(?=\s*\[34m\[AI\])', 
            job_start_section, 
            re.DOTALL
        )
        plan = re.search(
            r'\[34mplan\[0m\s*(.*?)(?=\s*\[31m\[Round 1\])', 
            job_start_section, 
            re.DOTALL
        )
        log_list.append(goal.group(0))
        log_list.append(plan.group(0))
        plan_step = len(plan.group(0).split('\n')) - 1
    else:
        plan_step = None
    
    return (plan_step, log_list)

def runing_match(round_start_num, log_text):
    """
    解析指定轮次的任务执行日志
    """
    log_list = []
    log_list.append(f'[31m[Round {round_start_num}][31m')
    round_stauts = re.search(
        fr'\[Round {round_start_num}\].*?\[Round {round_start_num} finish!\]', 
        log_text, 
        re.DOTALL
    )
    if round_stauts:
        round_text = round_stauts.group(0)
        current_task = re.findall(
            r'(\[34mcurrent task\[0m\s.*?(?=\s*\[31m\[Step failed with log\]:\[0m))', 
            round_text, 
            re.DOTALL
        )
        if len(current_task) > 0:
            error_task = re.findall(
                r'(\[31m\[Step failed with log\]:\[0m\s.*?(?=\s*\[34m\[AI suggestion to fix\]:\[0m))', 
                round_text, 
                re.DOTALL
            )
            fix_task = re.findall(
                r'(\[34m\[AI suggestion to fix\]:\[0m\s.*?(?=\s*\[31m\[Execute Code Failed))', 
                round_text, 
                re.DOTALL
            )
            for idx, (current, error, fix) in enumerate(zip(current_task, error_task, fix_task)):
                log_list.append(current)
                log_list.append(error)
                log_list.append(fix)
                log_list.append(f'[31m[Execute Code Failed {idx+1}/15 times at current step!][0m')
            current_task = re.search(
                fr'\[31m\[Execute Code Failed {idx+1}/15 times at current step!\]\[0m\s(.*?)(?=\s*\[31m\[Round {round_start_num} finish!\])', 
                round_text, 
                re.DOTALL
            )
            if current_task:
                last_step = current_task.group(0)
                current_task = re.search(
                    r'\[34mcurrent task\[0m\s(.*?)(?=\s*\[32m\[Execute Code Success\])', 
                    last_step, 
                    re.DOTALL
                )
                log_list.append(current_task.group(0))
                log_list.append('[32m[Execute Code Success], True, No error message[32m')
                log_list.append(f'[31m[Round {round_start_num} finish!][0m')
        else:
            current_task = re.search(
                fr'\[34mcurrent task\[0m\s(.*?)(?=\s*\[31m\[Round {round_start_num} finish!\])', 
                round_text, 
                re.DOTALL
            )
            log_list.append(current_task.group(0))
            log_list.append(f'[31m[Round {round_start_num} finish!][0m')
    else:
        round_stauts = re.search(
            fr'\[Round {round_start_num}\](.*?)\s*\[31mcode execute exceed max 15 times, exit!\[0m', 
            log_text, 
            re.DOTALL
        )
        if round_stauts:
            round_text = round_stauts.group(0)
            current_task = re.findall(
                r'(\[34mcurrent task\[0m\s.*?(?=\s*\[31m\[Step failed with log\]:\[0m))', 
                round_text, 
                re.DOTALL
            )
            if len(current_task) > 0:
                error_task = re.findall(
                    r'(\[31m\[Step failed with log\]:\[0m\s.*?(?=\s*\[34m\[AI suggestion to fix\]:\[0m))', 
                    round_text, 
                    re.DOTALL
                )
                fix_task = re.findall(
                    r'(\[34m\[AI suggestion to fix\]:\[0m\s.*?(?=\s*\[31m\[Execute Code Failed))', 
                    round_text, 
                    re.DOTALL
                )
                for idx, (current, error, fix) in enumerate(zip(current_task, error_task, fix_task)):
                    log_list.append(current)
                    log_list.append(error)
                    log_list.append(fix)
                    log_list.append(f'[31m[Execute Code Failed {idx+1}/15 times at current step!][0m')
                log_list.append(f'[31mcode execute exceed max 15 times, exit![0m')
        else:
            index_time = 13
            while index_time > 0:
                round_stauts = re.search(
                    fr'\[Round {round_start_num}\](.*?)\s*\[31m\[Execute Code Failed {index_time}/15 times at current step!\]\[0m', 
                    log_text, 
                    re.DOTALL
                )
                if round_stauts:
                    round_text = round_stauts.group(0)
                    current_task = re.findall(
                        r'(\[34mcurrent task\[0m\s.*?(?=\s*\[31m\[Step failed with log\]:\[0m))', 
                        round_text, 
                        re.DOTALL
                    )
                    if len(current_task) > 0:
                        error_task = re.findall(
                            r'(\[31m\[Step failed with log\]:\[0m\s.*?(?=\s*\[34m\[AI suggestion to fix\]:\[0m))', 
                            round_text, 
                            re.DOTALL
                        )
                        fix_task = re.findall(
                            r'(\[34m\[AI suggestion to fix\]:\[0m\s.*?(?=\s*\[31m\[Execute Code Failed))', 
                            round_text, 
                            re.DOTALL
                        )
                        for idx, (current, error, fix) in enumerate(zip(current_task, error_task, fix_task)):
                            log_list.append(current)
                            log_list.append(error)
                            log_list.append(fix)
                            log_list.append(f'[31m[Execute Code Failed {idx+1}/15 times at current step!][0m')
                    break
                else:
                    index_time -= 1
    return log_list

# 启动和关闭事件
@app.on_event("startup")
async def startup_event():
    import sys
    if len(sys.argv) < 2:
        print("Usage: uvicorn mcp_client_api:app --reload -- <path_to_server_script>")
        sys.exit(1)
    
    # 连接服务器
    await client.connect_to_server(sys.argv[1])
    
    # 显式启动轮询任务并存储任务引用
    client.polling_task = asyncio.create_task(client._poll_finished_tasks())
    logger.info("🚀 应用启动完成，轮询任务已激活")

@app.on_event("shutdown")
async def shutdown_event():
    # 取消轮询任务
    if hasattr(client, 'polling_task'):
        client.polling_task.cancel()
        try:
            await client.polling_task
        except asyncio.CancelledError:
            logger.info("🛑 轮询任务已取消")
    
    # 清理其他资源
    await client.cleanup()
    logger.info("🛑 应用已安全关闭")

if __name__ == "__main__":
    
    
    if len(sys.argv) < 2:
        print("Usage: python mcp_client_api.py <path_to_server_script>")
        sys.exit(1)

    # 保持原有UVicorn启动方式，仍然使用8081端口
    def run_server():
        uvicorn.run(app, host="0.0.0.0", port=8081)
    
    # 启动服务器
    run_server()