package api

type Error interface {
	Code() int
	HttpCode() int
	Error() string
}

type HttpError interface {
	Code() int
	HttpCode() int
	Error() string
}

type Response struct {
	Code  int         `json:"code"`
	Msg   string      `json:"msg"`
	Data  interface{} `json:"data"`
	Count int         `json:"count,omitempty"`
}

func Success(msg string) (int, Response) {
	if msg == "" {
		msg = "ok"
	}
	return 200, Response{
		Code: 0,
		Msg:  msg,
	}
}

func CustomHttpError(err HttpError) (int, Response) {
	code := err.HttpCode()
	if code == 0 {
		code = 200
	}
	return code, Response{
		Code: err.Code(),
		Msg:  err.Error(),
	}
}

func BadRequest(msg string) (int, Response) {
	if msg == "" {
		msg = "参数错误"
	}
	return 400, Response{
		Code: 400,
		Msg:  msg,
	}
}

func Unauthorized(msg string) (int, Response) {
	if msg == "" {
		msg = "请先登录"
	}
	return 401, Response{
		Code: 401,
		Msg:  msg,
	}
}

func Forbidden(msg string) (int, Response) {
	if msg == "" {
		msg = "无权访问"
	}
	return 403, Response{
		Code: 400,
		Msg:  msg,
	}
}

func ServerError(err error) (int, Response) {
	return 500, Response{
		Code: 500,
		Msg:  err.Error(),
	}
}
