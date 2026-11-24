package com.recrutement.authservice.repository;

import com.recrutement.authservice.entity.AdminAuditEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AdminAuditRepository extends JpaRepository<AdminAuditEntry, Long> {

    List<AdminAuditEntry> findTop50ByOrderByCreatedAtDesc();
}
