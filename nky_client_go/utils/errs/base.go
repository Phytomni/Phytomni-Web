package errs

import (
	"net/http"
	"nky_client_go/server/api"
)

const SuccessCode = 10000
const FailedCode = 10001

var (

	// Failed 操作失败
	Failed = &Err{
		code:     FailedCode,
		httpCode: 200,
		message:  "操作失败",
	}
)

type Err struct {
	code     int
	httpCode int
	message  string
}

func (err *Err) Code() int {
	return err.code
}

func (err *Err) HttpCode() int {
	return err.httpCode
}

func (err *Err) Error() string {
	return err.message
}

// LockedError signals that the auth/login path tripped account lockout.
// Handlers should type-assert *LockedError and surface a {locked: true}
// flag in the JSON response so the frontend can route to ElNotification
// without sniffing the error message text.
type LockedError struct {
	*Err
}

// NewLockedError builds a *LockedError with the given message and the
// default business code (http.StatusBadRequest) — matches errs.NewError.
func NewLockedError(message string) *LockedError {
	return &LockedError{Err: NewError(message)}
}

func ErrResp(err api.Error) (httpCode int, rsp Response) {
	httpCode = err.HttpCode()
	rsp = Response{
		Code: err.Code(),
		Msg:  err.Error(),
	}
	return
}

type Response struct {
	Code int         `json:"code" validate:"required"`    // 响应码
	Msg  string      `json:"message" validate:"required"` // 响应消息(JSON tag = message; Go field name remains Msg for caller compatibility)
	Data interface{} `json:"data"`                        // 响应数据
}

func SucResp(data interface{}) (resCode int, res Response) {
	resCode = 200
	res = Response{
		Code: resCode,
		Msg:  "success",
		Data: data,
	}
	return
}

func NewError(message string, args ...int) *Err {
	var (
		badRequestCode = http.StatusBadRequest
		httpCode       = http.StatusOK
	)

	for key, arg := range args {
		if key == 0 {
			badRequestCode = arg
		} else if key == 1 {
			httpCode = arg
		}
	}

	return &Err{
		code:     badRequestCode,
		httpCode: httpCode,
		message:  message,
	}
}
