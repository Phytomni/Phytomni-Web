# 直接使用轻量级 Alpine 作为运行环境
FROM golang:1.22-alpine

COPY ./config /app/config/
# 设置工作目录
WORKDIR /app

# 复制预先编译好的二进制文件
COPY main .

# 设置执行权限（可选）
RUN chmod +x main

# 暴露端口
EXPOSE 8082

# 启动应用
CMD ["./main"]