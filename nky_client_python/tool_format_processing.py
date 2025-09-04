import re
import os
import json
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import create_engine
from models import Base, QuestionAgentLog, BiMapping, ServerToolLogs, RagReferenceCitation
import platform
from dotenv import load_dotenv  # 新增

# 加载 .env 文件
load_dotenv()

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

def tool_chatAgent_result(content_dict):
    answer = content_dict["choices"][0]["message"]["content"]
    return answer

def tool_KnowledgeAgent_result(content_dict):
    answer = content_dict["choices"][0]["message"]["content"]
    try:
        follow_up_questions = content_dict["choices"][0]["message"]["follow_up_questions"]
    except (KeyError, IndexError, TypeError):
        follow_up_questions = None  # 或者任何适当的默认值

    if "doc_list" in content_dict["choices"][0]["message"]:
                    full_doc_list = content_dict["choices"][0]["message"]["doc_list"]
                    
                    # 匹配多种引用格式的正则表达式
                    pattern = r'\[(?:[a-zA-Z]+[: ]?)?(\d+(?:,\s*\d+)*)\]'
                    
                    # 1. 提取所有引用标记并记录首次出现顺序
                    citations = re.findall(pattern, answer)
                    
                    # 获取被引用的文档索引（按首次出现顺序记录）
                    citation_order = []
                    seen_indices = set()
                    for citation in citations:
                        for num in citation.split(','):
                            num = int(num.strip())
                            if num not in seen_indices:
                                seen_indices.add(num)
                                citation_order.append(num)
                    
                    # 2. 处理文档：去重 + 保持首次引用顺序
                    unique_docs = []  # 最终保留的文档（按首次引用顺序）
                    seen_titles = set()  # 已出现的title集合
                    original_idx_to_new_idx = {}  # 原始索引 -> 新索引的映射
                    current_new_idx = 1  # 新的序号从1开始
                    
                    # 按首次引用顺序处理文档
                    for old_idx in citation_order:
                        if 1 <= old_idx <= len(full_doc_list):
                            doc = full_doc_list[old_idx - 1]
                            file_id = doc.get("file_id")
                            
                            # 如果title未出现过则保留
                            if file_id not in seen_titles:
                                seen_titles.add(file_id)
                                unique_docs.append(doc)
                                # 记录原始索引到新索引的映射
                                original_idx_to_new_idx[old_idx] = current_new_idx
                                current_new_idx += 1
                    
                    # 3. 更新回答中的引用标记（统一改为新序号）
                    def replace_citation(match):
                        nums = match.group(1).split(',')
                        new_nums = []
                        for num in nums:
                            old_idx = int(num.strip())
                            if old_idx in original_idx_to_new_idx:
                                new_nums.append(str(original_idx_to_new_idx[old_idx]))
                        return f"[{','.join(new_nums)}]" if new_nums else ""
                    
                    updated_answer = re.sub(pattern, replace_citation, answer)
                    
                    db = SessionLocal()
                    # 4. 构建最终文档列表（按新序号顺序）
                    filtered_doc_list = []

                    for doc in unique_docs:
                        reference_citation=db.query(RagReferenceCitation).filter(RagReferenceCitation.file_id==doc.get("file_id")).first()

                        if reference_citation:
                            filtered_doc_list.append({
                                "file_id": reference_citation.file_id,
                                "au":reference_citation.au,
                                "ti":reference_citation.ti,
                                "so":reference_citation.so,
                                "vl":reference_citation.vl,
                                "bp":reference_citation.bp,
                                "ep":reference_citation.ep,
                                "py":reference_citation.py,
                                "di":reference_citation.di,
                                "dl":reference_citation.dl,
                                "pm":reference_citation.pm,
                            })
                        else:
                            title = doc.get("title", "")  # 获取title，默认为空字符串
                            # 如果title以.pdf结尾，则去掉.pdf
                            if title.endswith('.pdf'):
                                title = title[:-4]  # 去掉最后4个字符(.pdf)
                                
                            filtered_doc_list.append({
                                "file_id": doc.get("file_id"),
                                "title":title,
                            })

                    # 返回结构化结果
                    structured_answer = {
                        "content": updated_answer,
                        "doc_list": filtered_doc_list,
                    }
                    answer = json.dumps(structured_answer, ensure_ascii=False)
    return answer,follow_up_questions

def tool_DataAgent_result(content_dict):
    headers = [col["caption"] for col in content_dict["header"]]
    table_data = content_dict["data"]
    # 处理字段映射
    mapped_headers = map_fields_via_database(headers)
    table_info = {
        "headers": mapped_headers,
        "rows": table_data
    }
    answer = json.dumps(table_info, ensure_ascii=False)
    return answer

def tool_AnalystAgent_result(content_dict):
    task_id = content_dict.get("task_id")
    download_path = content_dict.get("output_dir")
    compute_resource = content_dict.get("compute_resource")
    task_mapping = {
        'small': 'analyst-agents-small',
        'medium': 'analyst-agents-medium',
        'large': 'analyst-agents-large'
    }
    if compute_resource in task_mapping:
        compute_resource = task_mapping[compute_resource]
        print(f"匹配的任务资源名称: {compute_resource}")
    else:
        print(f"无效的compute_resource值: {compute_resource}")
    answer =  f"任务创建成功：{task_id}"
    status = "RUNNING"   
    log_status = "sync_running"
    return task_id,download_path,compute_resource,answer,status,log_status

def tool_ReviewAgent_result(content_dict):
    answer = content_dict["choices"][0]["message"]["content"]
    try:
        follow_up_questions = content_dict["choices"][0]["message"]["follow_up_questions"]
    except (KeyError, IndexError, TypeError):
        follow_up_questions = []  # 或者任何适当的默认值
        
    if "doc_list" in content_dict["choices"][0]["message"]:
                    full_doc_list = content_dict["choices"][0]["message"]["doc_list"]
                    
                    # 匹配多种引用格式的正则表达式
                    pattern = r'\[(?:[a-zA-Z]+[: ]?)?(\d+(?:,\s*\d+)*)\]'
                    
                    # 1. 提取所有引用标记并记录首次出现顺序
                    citations = re.findall(pattern, answer)
                    
                    # 获取被引用的文档索引（按首次出现顺序记录）
                    citation_order = []
                    seen_indices = set()
                    for citation in citations:
                        for num in citation.split(','):
                            num = int(num.strip())
                            if num not in seen_indices:
                                seen_indices.add(num)
                                citation_order.append(num)
                    
                    # 2. 处理文档：去重 + 保持首次引用顺序
                    unique_docs = []  # 最终保留的文档（按首次引用顺序）
                    seen_titles = set()  # 已出现的title集合
                    original_idx_to_new_idx = {}  # 原始索引 -> 新索引的映射
                    current_new_idx = 1  # 新的序号从1开始
                    
                    # 按首次引用顺序处理文档
                    for old_idx in citation_order:
                        if 1 <= old_idx <= len(full_doc_list):
                            doc = full_doc_list[old_idx - 1]
                            file_id = doc.get("file_id")
                            
                            # 如果title未出现过则保留
                            if file_id not in seen_titles:
                                seen_titles.add(file_id)
                                unique_docs.append(doc)
                                # 记录原始索引到新索引的映射
                                original_idx_to_new_idx[old_idx] = current_new_idx
                                current_new_idx += 1
                    
                    # 3. 更新回答中的引用标记（统一改为新序号）
                    def replace_citation(match):
                        nums = match.group(1).split(',')
                        new_nums = []
                        for num in nums:
                            old_idx = int(num.strip())
                            if old_idx in original_idx_to_new_idx:
                                new_nums.append(str(original_idx_to_new_idx[old_idx]))
                        return f"[{','.join(new_nums)}]" if new_nums else ""
                    
                    updated_answer = re.sub(pattern, replace_citation, answer)
                    
                    db = SessionLocal()
                    # 4. 构建最终文档列表（按新序号顺序）
                    filtered_doc_list = []

                    for doc in unique_docs:
                        reference_citation=db.query(RagReferenceCitation).filter(RagReferenceCitation.file_id==doc.get("file_id")).first()

                        if reference_citation:
                            filtered_doc_list.append({
                                "file_id": reference_citation.file_id,
                                "au":reference_citation.au,
                                "ti":reference_citation.ti,
                                "so":reference_citation.so,
                                "vl":reference_citation.vl,
                                "bp":reference_citation.bp,
                                "ep":reference_citation.ep,
                                "py":reference_citation.py,
                                "di":reference_citation.di,
                                "dl":reference_citation.dl,
                                "pm":reference_citation.pm,
                            })
                        else:
                            title = doc.get("title", "")  # 获取title，默认为空字符串
                            # 如果title以.pdf结尾，则去掉.pdf
                            if title.endswith('.pdf'):
                                title = title[:-4]  # 去掉最后4个字符(.pdf)
                                
                            filtered_doc_list.append({
                                "file_id": doc.get("file_id"),
                                "title":title,
                            })

                    # 返回结构化结果
                    structured_answer = {
                        "content": updated_answer,
                        "doc_list": filtered_doc_list,
                    }
                    answer = json.dumps(structured_answer, ensure_ascii=False)
    return answer,follow_up_questions

def tool_DeepGenomeAgent_result(json_str,arguments_str):
    # 返回的content作为server_id入库同步server表
    data = json.loads(json_str) 
    server_id = data["task_id"]
    answer = f"server任务创建成功：{server_id}"
    arguments_dict = json.loads(arguments_str)
    # 提取值
    species_code = arguments_dict["species_code"]  # 获取 "osa"
    gene_id = arguments_dict["gene_id"]  # 获取 "d18h"
    status = "RUNNING"  
    
    return answer,server_id,species_code,gene_id,status

def tool_DeepGenomeAgent_file_result(content_dict,server_file_path):
    answer = content_dict["choices"][0]["message"]["content"]
    try:
        follow_up_questions = content_dict["choices"][0]["message"]["follow_up_questions"]
    except (KeyError, IndexError, TypeError):
        follow_up_questions = None  # 或者任何适当的默认值

    if "doc_list" in content_dict["choices"][0]["message"]:
                    full_doc_list = content_dict["choices"][0]["message"]["doc_list"]
                    
                    # 匹配多种引用格式的正则表达式
                    pattern = r'\[(?:[a-zA-Z]+[: ]?)?(\d+(?:,\s*\d+)*)\]'
                    
                    # 1. 提取所有引用标记并记录首次出现顺序
                    citations = re.findall(pattern, answer)
                    
                    # 获取被引用的文档索引（按首次出现顺序记录）
                    citation_order = []
                    seen_indices = set()
                    for citation in citations:
                        for num in citation.split(','):
                            num = int(num.strip())
                            if num not in seen_indices:
                                seen_indices.add(num)
                                citation_order.append(num)
                    
                    # 2. 处理文档：去重 + 保持首次引用顺序
                    unique_docs = []  # 最终保留的文档（按首次引用顺序）
                    seen_titles = set()  # 已出现的title集合
                    original_idx_to_new_idx = {}  # 原始索引 -> 新索引的映射
                    current_new_idx = 1  # 新的序号从1开始
                    
                    # 按首次引用顺序处理文档
                    for old_idx in citation_order:
                        if 1 <= old_idx <= len(full_doc_list):
                            doc = full_doc_list[old_idx - 1]
                            file_id = doc.get("file_id")
                            
                            # 如果title未出现过则保留
                            if file_id not in seen_titles:
                                seen_titles.add(file_id)
                                unique_docs.append(doc)
                                # 记录原始索引到新索引的映射
                                original_idx_to_new_idx[old_idx] = current_new_idx
                                current_new_idx += 1
                    
                    # 3. 更新回答中的引用标记（统一改为新序号）
                    def replace_citation(match):
                        nums = match.group(1).split(',')
                        new_nums = []
                        for num in nums:
                            old_idx = int(num.strip())
                            if old_idx in original_idx_to_new_idx:
                                new_nums.append(str(original_idx_to_new_idx[old_idx]))
                        return f"[{','.join(new_nums)}]" if new_nums else ""
                    
                    updated_answer = re.sub(pattern, replace_citation, answer)
                    
                    db = SessionLocal()
                    # 4. 构建最终文档列表（按新序号顺序）
                    filtered_doc_list = []

                    for doc in unique_docs:
                        reference_citation=db.query(RagReferenceCitation).filter(RagReferenceCitation.file_id==doc.get("file_id")).first()

                        if reference_citation:
                            filtered_doc_list.append({
                                "file_id": reference_citation.file_id,
                                "au":reference_citation.au,
                                "ti":reference_citation.ti,
                                "so":reference_citation.so,
                                "vl":reference_citation.vl,
                                "bp":reference_citation.bp,
                                "ep":reference_citation.ep,
                                "py":reference_citation.py,
                                "di":reference_citation.di,
                                "dl":reference_citation.dl,
                                "pm":reference_citation.pm,
                            })
                        else:
                            title = doc.get("title", "")  # 获取title，默认为空字符串
                            # 如果title以.pdf结尾，则去掉.pdf
                            if title.endswith('.pdf'):
                                title = title[:-4]  # 去掉最后4个字符(.pdf)
                                
                            filtered_doc_list.append({
                                "file_id": doc.get("file_id"),
                                "title":title,
                            })
                    # 生成.md文件，格式为updated_answer
                    #server_file_path = /home/xieshang/Workdir/1.phytomni/Phytomni_Bot/src/mcp_server_phytomni/.out/Os02g0278700_results.md
                    #我要在Os02g0278700_results.md的同路径下生成内容为updated_answer的.md文件，文件名为new_Os02g0278700_results.md
                    #赋值server_file_path等于新的.md文件路径并返回
                    # 从原文件路径构建新文件路径
                    dir_name = os.path.dirname(server_file_path)  # 获取目录路径
                    base_name = os.path.basename(server_file_path)  # 获取文件名
                    new_base_name = "new_" + base_name  # 添加前缀
                    new_file_path = os.path.join(dir_name, new_base_name)  # 组合新路径

                    # 将updated_answer内容写入新文件
                    try:
                        with open(new_file_path, 'w', encoding='utf-8') as md_file:
                            md_file.write(updated_answer)
                        print(f"成功生成Markdown文件: {new_file_path}")
                    except Exception as e:
                        print(f"写入文件时出错: {str(e)}")
                        # 可以根据需要处理错误，例如返回原始路径或抛出异常

                    # 更新server_file_path为新的文件路径
                    server_file_path = new_file_path

                    # 返回结构化结果
                    structured_answer = {
                        "content": updated_answer,
                        "doc_list": filtered_doc_list,
                    }
                    answer = json.dumps(structured_answer, ensure_ascii=False)
    return answer,follow_up_questions,new_file_path,new_base_name


def tool_InSilicoResearchAgent_result():
    return

def map_fields_via_database(original_headers):
        # 初始化数据库连接 (请替换为你的实际连接字符串)
        db = SessionLocal()
        
        try:
            # 查询映射关系 (注意查询字段名已修正为source_field)
            mappings = db.query(BiMapping).filter(
                BiMapping.source_field.in_(original_headers)
            ).all()
            
            # 创建映射字典
            field_mapping = {m.source_field: m.target_field for m in mappings}
            
            # 应用映射 (保留未找到映射的原始字段)
            mapped_headers = [field_mapping.get(header, header) for header in original_headers]
            
            return mapped_headers
        finally:
            db.close()


# async def get_huaweicloud_token():
    #     auth_data = {
    #         "auth": {
    #             "identity": {
    #                 "password": {
    #                     "user": {
    #                         "name": "myc",
    #                         "password": "mao3890391",
    #                         "domain": {
    #                             "name": "hid_c2mvy0ux4s6ad-l"
    #                         }
    #                     }
    #                 },
    #                 "methods": ["password"]
    #             },
    #             "scope": {
    #                 "project": {
    #                     "name": "cn-east-3"
    #                 }
    #             }
    #         }
    #     }

    #     try:
    #         # 发送认证请求
    #         auth_url = "https://iam.cn-east-3.myhuaweicloud.com/v3/auth/tokens"
    #         headers = {"Content-Type": "application/json"}
            
    #         # 禁用SSL验证（与Go代码中的InsecureSkipVerify=True等效）
    #         response = requests.post(
    #             auth_url,
    #             data=json.dumps(auth_data),
    #             headers=headers,
    #             verify=False  # 禁用SSL证书验证
    #         )

    #         # 检查响应状态码
    #         if response.status_code >= 400:
    #             print(f"认证失败，状态码: {response.status_code}")
    #             return None

    #         # 获取X-Subject-Token
    #         xs_token = response.headers.get('X-Subject-Token')
    #         if not xs_token:
    #             print("未获取到认证token")
    #             return None

    #         return xs_token

    #     except requests.exceptions.RequestException as e:
    #         print(f"认证请求失败: {e}")
    #         return None
    #     except json.JSONDecodeError as e:
    #         print(f"JSON处理失败: {e}")
    #         return None
        
    # async def get_huaweicloud_task_log(task_id,compute_resource,xs_token):
    #     job_log_url = f"https://eihealth.cn-east-3.myhuaweicloud.com/v1/f9afc0650aec4f9cbc7af24e9e199e77/eihealth-projects/6d50805e-8546-4c8b-a3c0-f7aa8b82bb74/jobs/{task_id}/logs?task_name={compute_resource}"
    #     job_log_headers = {"Content-Type": "application/json", "X-Auth-Token": xs_token}
    #     job_log_response = requests.get(job_log_url, headers=job_log_headers, verify=False)
    #     print(type(job_log_response.text))
        

    # def map_fields_via_database(self,original_headers):
    #     # 初始化数据库连接 (请替换为你的实际连接字符串)
    #     db = SessionLocal()
        
    #     try:
    #         # 查询映射关系 (注意查询字段名已修正为source_field)
    #         mappings = db.query(BiMapping).filter(
    #             BiMapping.source_field.in_(original_headers)
    #         ).all()
            
    #         # 创建映射字典
    #         field_mapping = {m.source_field: m.target_field for m in mappings}
            
    #         # 应用映射 (保留未找到映射的原始字段)
    #         mapped_headers = [field_mapping.get(header, header) for header in original_headers]
            
    #         return mapped_headers
    #     finally:
    #         db.close()

