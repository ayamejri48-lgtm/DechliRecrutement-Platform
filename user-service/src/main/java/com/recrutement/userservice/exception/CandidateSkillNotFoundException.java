package com.recrutement.userservice.exception;

public class CandidateSkillNotFoundException extends RuntimeException {

    public CandidateSkillNotFoundException(String message) {
        super(message);
    }
}