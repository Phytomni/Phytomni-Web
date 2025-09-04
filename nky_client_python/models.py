# models.py
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum
from sqlalchemy.orm import declarative_base

Base = declarative_base()

# 数据库模型
class QuestionAgentLog(Base):
    __tablename__ = "s_question_agent_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dialogue_id = Column(String(255))
    f_id = Column(Integer)
    server_id = Column(String(255))
    user_name = Column(String(255), nullable=False)
    query = Column(Text)
    title_query = Column(Text)
    answer = Column(Text)
    follow_up_questions = Column(Text)
    species_code = Column(String(255))
    gene_id = Column(String(255))
    task_id = Column(String(50))
    task_log = Column(Text)
    file_name = Column(String(255))
    upload_path = Column(String(255))
    download_path = Column(String(255))
    compute_resource = Column(String(50))
    server_file_path = Column(String(255))
    tool_name = Column(String(30))
    status = Column(String(30))
    log_status = Column(String(30))
    reaction_type = Column(Enum('0', '1', '2', name='reaction_type'))
    collect_type = Column(Enum('0', '1', name='collect_type'))
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    delete_at = Column(DateTime)

class BiMapping(Base):
    __tablename__ = "s_bi_mapping"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_field = Column(String(100))
    target_field = Column(String(100))

class ServerToolLogs(Base):
    __tablename__ = "s_server_tool_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    server_id = Column(String(255))
    tool_result = Column(Text)
    tool_name = Column(String(30))
    server_file_path = Column(String(255))
    server_status = Column(String(30))
    sync_status = Column(Integer)
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    delete_at = Column(DateTime)

class RagReferenceCitation(Base):
    __tablename__ = "s_rag_reference_citation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_id = Column(String(100), comment='unique_id')
    au = Column(String(255), comment='作者（AU）')
    ti = Column(Text, comment='文献名（TI）')
    so = Column(String(255), comment='来源/期刊名(SO)')
    vl = Column(String(255), comment='卷号(VL)')
    bp = Column(String(255), comment='起始页码(BP)')
    ep = Column(String(255), comment='结束页码(EP)')
    py = Column(String(255), comment='出版年份(PY)')
    di = Column(String(255), comment='DOI标识符(DI)')
    dl = Column(String(255), comment='DOI下载链接(DL)')
    pm = Column(String(255), comment='PubMed ID(PM)')


class GeneExample(Base):
    __tablename__ = "s_gene_example"
    id = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(String(255), comment='文件名')
    server_file_path = Column(String(255))
    content = Column(Text, comment='内容')
    species_code = Column(String(255), comment='物种代码')
    gene_id = Column(Text, comment='基因ID')
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    delete_at = Column(DateTime)
