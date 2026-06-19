package utils

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
)

// UrlExists 判断远程url是否存在
func UrlExists(url string) bool {
	resp, err := http.Head(url)
	if err != nil {
		fmt.Println("Error:", err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return true
	}
	return false
}

// DownloadFile 将远程文件下载到本地
func DownloadFile(url, path, filepath string) error {
	ExistDir(path)
	// 创建文件
	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	// 发送 GET 请求
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 检查 HTTP 响应状态码
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	// 将响应 Body 写入文件
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	return nil
}

// ReadFileContent 使用 os 包中的 Open 函数打开文件，然后使用 io 包中的 Read 方法逐字节或指定大小读取文件内容。
func ReadFileContent(filename string) ([]byte, error) {
	file, err := os.Open(filename)
	if err != nil {
		log.Fatal(err)
		return nil, err
	}
	defer file.Close()

	content := make([]byte, 0)
	buf := make([]byte, 1024) // 指定读取的缓冲区大小

	for {
		n, err := file.Read(buf)
		if err != nil && err != io.EOF {
			log.Fatal(err)
			return nil, err
		}
		if n == 0 {
			break
		}
		content = append(content, buf[:n]...)
	}
	return content, nil
}

// ReadFileContentLineByLine 使用 os 包中的 Open 函数打开文件，然后使用 bufio 包中的 Scanner 对象逐行读取文件内容
func ReadFileContentLineByLine(filename string) ([]string, error) {
	file, err := os.Open(filename)
	if err != nil {
		log.Fatal(err)
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	content := make([]string, 0)
	for scanner.Scan() {
		content = append(content, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		log.Fatal(err)
		return nil, err
	}
	return content, nil
}

// readFileContentOnce 使用 ioutil 包中的 ReadFile 函数一次性读取整个文件的内容
func readFileContentOnce(filename string) ([]byte, error) {
	content, err := ioutil.ReadFile(filename)
	if err != nil {
		log.Fatal(err)
		return nil, err
	}
	return content, nil
}

// AppendToFile 将字符串内容追加到指定的文件
func AppendToFile(fileName, text string) error {
	// 打开文件，使用 os.O_APPEND 追加模式
	file, err := os.OpenFile(fileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	writer := bufio.NewWriter(file)
	_, err = writer.WriteString(text + "\n")
	if err != nil {
		return fmt.Errorf("failed to write to file: %w", err)
	}

	// 确保数据被刷新到文件中
	err = writer.Flush()
	if err != nil {
		return fmt.Errorf("failed to flush writer: %w", err)
	}

	return nil
}

// IsDirectory 判断指定的目录是否存在
func IsDirectory(path string) (bool, error) {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return info.IsDir(), nil
}

func CreateFile(fileName string) {
	// 创建文件，使用 os.O_CREATE | os.O_WRONLY 标志
	file, err := os.OpenFile(fileName, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("创建文件 %s 时出错: %v\n", fileName, err)
		return
	}
	defer file.Close()
}

func FileExists(name string) (bool, error) {
	_, err := os.Stat(name)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func FilesExists(names []string) bool {
	for _, name := range names {
		ok, _ := FileExists(name)
		if ok {
			return ok
		}
	}
	return false
}
