package com.recrutement.offreservice.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public class AiServiceException extends RuntimeException {

    private final HttpStatus status;
    private final String errorCode;

    public AiServiceException(String message, String errorCode, HttpStatus status) {
        super(message);
        this.errorCode = errorCode;
        this.status = status;
    }
}
