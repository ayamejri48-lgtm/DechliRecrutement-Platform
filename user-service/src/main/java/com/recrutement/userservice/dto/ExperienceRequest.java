package com.recrutement.userservice.dto;

import jakarta.validation.constraints.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;

@Getter
@Setter
public class ExperienceRequest {

    @NotBlank
    @Size(max = 150)
    private String jobTitle;

    @NotBlank
    @Size(max = 150)
    private String company;

    @NotNull
    private LocalDate startDate;

    private LocalDate endDate;

    @Size(max = 2000)
    private String description;
}